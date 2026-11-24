/**
 * Builds a single ledger of every asset movement (players, draft picks and FAAB)
 * across every season of the league, by walking back through previous_league_id.
 *
 * This file intentionally has no $lib / svelte imports so it can run anywhere.
 *
 * Asset keys:
 *   player:<player_id>
 *   pick:<season>-<round>-<original_roster_id>
 */

const API = 'https://api.sleeper.app/v1';

export const pickKey = (season, round, originalRoster) => `pick:${season}-${round}-${originalRoster}`;
export const playerKey = (playerID) => `player:${playerID}`;

const getJSON = async (fetchFn, path) => {
    const res = await fetchFn(`${API}/${path}`, {compress: true});
    if(!res.ok) throw new Error(`Sleeper request failed: ${path}`);
    return res.json();
};

export const buildAssetHistory = async (startLeagueID, fetchFn = fetch) => {
    // 1. walk the league chain (newest first)
    const leagues = [];
    let currentLeagueID = startLeagueID;
    while(currentLeagueID && currentLeagueID != 0) {
        const league = await getJSON(fetchFn, `league/${currentLeagueID}`);
        leagues.push(league);
        currentLeagueID = league.previous_league_id;
    }
    const currentLeague = leagues[0];
    const currentSeason = parseInt(currentLeague.season);

    // 2. fetch everything for every season in parallel
    const seasonData = await Promise.all(leagues.map(async (league) => {
        const weeks = [...Array(19).keys()]; // 0 - 18
        const [transactionWeeks, drafts] = await Promise.all([
            Promise.all(weeks.map(w => getJSON(fetchFn, `league/${league.league_id}/transactions/${w}`).catch(() => []))),
            getJSON(fetchFn, `league/${league.league_id}/drafts`),
        ]);
        const draftDetails = await Promise.all(drafts.map(async (d) => {
            const [detail, picks, tradedPicks] = await Promise.all([
                getJSON(fetchFn, `draft/${d.draft_id}`),
                d.status == 'complete' || d.status == 'drafting' ? getJSON(fetchFn, `draft/${d.draft_id}/picks`) : [],
                getJSON(fetchFn, `draft/${d.draft_id}/traded_picks`).catch(() => []),
            ]);
            return {...detail, picks, tradedPicks};
        }));
        return {
            league,
            season: parseInt(league.season),
            transactions: transactionWeeks.flat().filter(t => t && t.status == 'complete'),
            drafts: draftDetails,
        };
    }));

    const [currentRosters, currentTradedPicks] = await Promise.all([
        getJSON(fetchFn, `league/${currentLeague.league_id}/rosters`),
        getJSON(fetchFn, `league/${currentLeague.league_id}/traded_picks`),
    ]);

    const assets = {};
    const events = [];
    const transactions = {};
    const playerNames = {}; // fallback names from draft metadata

    const ensurePlayer = (playerID) => {
        const key = playerKey(playerID);
        if(!assets[key]) assets[key] = {key, kind: 'player', playerID, events: []};
        return assets[key];
    };
    const ensurePick = (season, round, original) => {
        const key = pickKey(season, round, original);
        if(!assets[key]) assets[key] = {key, kind: 'pick', season: parseInt(season), round: parseInt(round), original: parseInt(original), events: [], usedOn: null};
        return assets[key];
    };

    // 3. drafts -> draft events (and pick usage)
    const seasonsWithCompletedDraft = new Set();
    for(const {league, season, drafts} of seasonData) {
        const sortedDrafts = [...drafts].sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
        for(const draft of sortedDrafts) {
            // the league's own draft_id is the one draft picks are traded for (rookie draft);
            // any other draft (e.g. a startup draft) is just a source of acquisitions
            const isPickDraft = draft.draft_id == league.draft_id;
            const isStartup = !isPickDraft || (draft.settings?.rounds || 0) > (league.settings?.draft_rounds || 0) + 5;
            if(isPickDraft && draft.status == 'complete') seasonsWithCompletedDraft.add(season);
            const teams = draft.settings?.teams || Object.keys(draft.slot_to_roster_id || {}).length || 12;
            const ts = draft.last_picked || draft.start_time || 0;
            const draftName = `${season} ${isStartup ? 'Startup' : 'Rookie'} Draft`;

            for(const pick of draft.picks) {
                if(!pick.player_id) continue;
                const pickInRound = pick.pick_no - (pick.round - 1) * teams;
                const pickLabel = `${pick.round}.${String(pickInRound).padStart(2, '0')}`;
                if(pick.metadata?.first_name) {
                    playerNames[pick.player_id] = {
                        fn: pick.metadata.first_name,
                        ln: pick.metadata.last_name,
                        pos: pick.metadata.position,
                    };
                }
                const player = ensurePlayer(pick.player_id);
                let pickAssetKey = null;
                if(isPickDraft && !isStartup) {
                    const original = draft.slot_to_roster_id?.[pick.draft_slot] ?? pick.roster_id;
                    const pickAsset = ensurePick(season, pick.round, original);
                    pickAssetKey = pickAsset.key;
                    const traded = (draft.tradedPicks || []).find(tp => tp.round == pick.round && tp.roster_id == original);
                    pickAsset.usedOn = {
                        player: player.key, pickLabel, pickNo: pick.pick_no, roster: pick.roster_id,
                        previousOwner: traded?.previous_owner_id ?? null, draftStart: draft.start_time || ts, season,
                    };
                    const usedEvent = {
                        id: events.length, ts: (draft.start_time || ts) + pick.pick_no, season, type: 'pick_used',
                        asset: pickAsset.key, from: pick.roster_id, to: null, roster: pick.roster_id,
                        linked: player.key, pickLabel, draftName,
                    };
                    events.push(usedEvent);
                    pickAsset.events.push(usedEvent.id);
                }
                const draftEvent = {
                    id: events.length, ts: (draft.start_time || ts) + pick.pick_no, season, type: 'draft',
                    asset: player.key, from: null, to: pick.roster_id, roster: pick.roster_id,
                    linked: pickAssetKey, pickLabel, draftName,
                };
                events.push(draftEvent);
                player.events.push(draftEvent.id);
            }
        }
    }

    // 4. transactions -> movement events
    for(const {season, transactions: seasonTransactions} of seasonData) {
        for(const t of seasonTransactions) {
            const ts = t.status_updated || t.created;
            const tx = {
                id: t.transaction_id, ts, season, type: t.type, rosters: t.roster_ids || [],
                moves: [], // {asset, from, to, bid}
                faab: (t.waiver_budget || []).map(b => ({from: b.sender, to: b.receiver, amount: b.amount})),
            };
            const adds = t.adds || {};
            const drops = t.drops || {};
            const bid = t.settings?.waiver_bid;

            const pushEvent = (assetObj, type, from, to, extra = {}) => {
                const ev = {id: events.length, ts, season, type, asset: assetObj.key, from, to, tx: tx.id, ...extra};
                events.push(ev);
                assetObj.events.push(ev.id);
                tx.moves.push({asset: assetObj.key, from, to, ...extra});
            };

            for(const pid in adds) {
                const player = ensurePlayer(pid);
                const from = drops[pid] ?? null;
                if(t.type == 'trade') {
                    pushEvent(player, 'trade', from, adds[pid]);
                } else if(t.type == 'commissioner') {
                    pushEvent(player, 'commissioner', from, adds[pid]);
                } else {
                    pushEvent(player, t.type, from, adds[pid], t.type == 'waiver' && bid != null ? {bid} : {});
                }
            }
            for(const pid in drops) {
                if(pid in adds) continue;
                const player = ensurePlayer(pid);
                pushEvent(player, t.type == 'commissioner' ? 'commissioner' : 'drop', drops[pid], null);
            }
            for(const p of (t.draft_picks || [])) {
                const pick = ensurePick(p.season, p.round, p.roster_id);
                pushEvent(pick, t.type == 'commissioner' ? 'commissioner' : 'trade', p.previous_owner_id, p.owner_id);
            }
            if(tx.moves.length || tx.faab.length) transactions[tx.id] = tx;
        }
    }

    // 5. make sure every pick exists (including untraded future picks)
    const rounds = currentLeague.settings?.draft_rounds || 3;
    const rosterIDs = currentRosters.map(r => r.roster_id).sort((a, b) => a - b);
    const currentDraftDone = seasonsWithCompletedDraft.has(currentSeason);
    const firstFutureSeason = currentDraftDone ? currentSeason + 1 : currentSeason;
    const pickSeasons = new Set([...seasonsWithCompletedDraft]);
    for(let s = firstFutureSeason; s < firstFutureSeason + 3; s++) pickSeasons.add(s);
    for(const tp of currentTradedPicks) pickSeasons.add(parseInt(tp.season));
    for(const season of pickSeasons) {
        for(let round = 1; round <= rounds; round++) {
            for(const r of rosterIDs) ensurePick(season, round, r);
        }
    }

    // 6. Sleeper doesn't log every pick trade (e.g. trades made inside the startup draft room).
    // Reconcile replayed ownership against Sleeper's authoritative owner and add the missing hops.
    const addUnrecorded = (asset, from, to, ts, season) => {
        const ev = {id: events.length, ts, season, type: 'unrecorded', asset: asset.key, from, to};
        events.push(ev);
        asset.events.push(ev.id);
    };
    const replayOwner = (asset) => {
        let owner = asset.original;
        for(const eid of [...asset.events].sort((a, b) => events[a].ts - events[b].ts || a - b)) {
            const ev = events[eid];
            if(ev.type != 'pick_used' && ev.to != null) owner = ev.to;
        }
        return owner;
    };
    const reconcile = (asset, actualOwner, previousOwner, ts, season) => {
        const replayed = replayOwner(asset);
        if(actualOwner == null || replayed == actualOwner) return;
        if(previousOwner != null && previousOwner != replayed && previousOwner != actualOwner) {
            addUnrecorded(asset, replayed, previousOwner, ts - 1, season);
            addUnrecorded(asset, previousOwner, actualOwner, ts, season);
        } else {
            addUnrecorded(asset, replayed, actualOwner, ts, season);
        }
    };
    for(const key in assets) {
        const asset = assets[key];
        if(asset.kind == 'pick' && asset.usedOn) {
            reconcile(asset, asset.usedOn.roster, asset.usedOn.previousOwner, asset.usedOn.draftStart - 10, asset.usedOn.season);
        }
    }
    for(const tp of currentTradedPicks) {
        const pick = assets[pickKey(tp.season, tp.round, tp.roster_id)];
        if(pick && !pick.usedOn) reconcile(pick, tp.owner_id, tp.previous_owner_id, Date.now(), currentSeason);
    }

    // 7. draft picks have no timestamp of their own; make sure a pick is only "used"
    // after every trade involving it (draft-day trades happen after the draft starts)
    for(const key in assets) {
        const asset = assets[key];
        if(asset.kind != 'pick' || !asset.usedOn) continue;
        const usedEvent = asset.events.map(id => events[id]).find(ev => ev.type == 'pick_used');
        const lastMove = Math.max(...asset.events.map(id => events[id]).filter(ev => ev.type != 'pick_used').map(ev => ev.ts), 0);
        if(usedEvent && lastMove >= usedEvent.ts) {
            usedEvent.ts = lastMove + 1;
            const draftEvent = assets[usedEvent.linked]?.events.map(id => events[id]).find(ev => ev.type == 'draft' && ev.linked == key);
            if(draftEvent) draftEvent.ts = usedEvent.ts;
        }
    }

    // 8. order every asset's events chronologically and compute owners
    for(const key in assets) {
        const asset = assets[key];
        asset.events.sort((a, b) => events[a].ts - events[b].ts || a - b);
        if(asset.kind == 'pick') {
            let owner = asset.original;
            let trades = 0;
            for(const eid of asset.events) {
                const ev = events[eid];
                if(ev.type == 'pick_used') continue;
                if(ev.to != null) owner = ev.to;
                trades++;
            }
            asset.owner = owner;
            asset.trades = trades;
            asset.future = !asset.usedOn && asset.season >= firstFutureSeason;
        }
    }
    const playerOwner = {};
    for(const roster of currentRosters) {
        for(const pid of (roster.players || [])) playerOwner[pid] = roster.roster_id;
    }
    for(const key in assets) {
        const asset = assets[key];
        if(asset.kind == 'player') asset.owner = playerOwner[asset.playerID] ?? null;
    }

    return {
        currentSeason,
        seasons: seasonData.map(s => s.season).sort((a, b) => b - a),
        pickSeasons: [...pickSeasons].sort((a, b) => b - a),
        rounds,
        rosterIDs,
        assets,
        events,
        transactions,
        playerNames,
    };
};
