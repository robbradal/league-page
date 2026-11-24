<script>
    import { onMount, tick } from 'svelte';
    import { browser } from '$app/environment';
    import TeamName from './TeamName.svelte';

    export let history, players, leagueTeamManagers, initialAsset = null, initialView = 'moves';

    const PAGE_SIZE = 75;

    let view = ['moves', 'picks'].includes(initialView) ? initialView : 'moves';
    let selected = initialAsset && history.assets[initialAsset] ? initialAsset : null;
    let query = '';
    let seasonFilter = 'all';
    let typeFilter = 'all';
    let teamFilter = 'all';
    let shown = PAGE_SIZE;
    let pickSeason = history.pickSeasons.find(s => s <= history.currentSeason + 1) ?? history.pickSeasons[0];
    let detailEl;
    let showSuggestions = false;

    const typeLabels = {
        trade: 'Trade',
        unrecorded: 'Trade',
        waiver: 'Waiver',
        free_agent: 'Free Agent',
        drop: 'Drop',
        commissioner: 'Commish',
        draft: 'Draft',
        pick_used: 'Pick Used',
    };
    const typeFilters = [
        ['all', 'All types'],
        ['trade', 'Trades'],
        ['add', 'Waivers & free agents'],
        ['drop', 'Drops'],
        ['draft', 'Draft selections'],
        ['commissioner', 'Commissioner moves'],
    ];

    // ---------- naming helpers ----------
    const teamsMap = leagueTeamManagers.teamManagersMap;
    const teamSeason = (season) => {
        if(!season || season > leagueTeamManagers.currentSeason || !teamsMap[season]) return leagueTeamManagers.currentSeason;
        return season;
    };
    const team = (roster, season) => {
        if(roster == null) return null;
        return teamsMap[teamSeason(season)]?.[roster]?.team || teamsMap[leagueTeamManagers.currentSeason]?.[roster]?.team || {name: `Team ${roster}`, avatar: ''};
    };
    const teamName = (roster, season) => team(roster, season)?.name ?? '';
    const currentTeamName = (roster) => teamName(roster, leagueTeamManagers.currentSeason);

    const playerInfo = (id) => players?.[id] || history.playerNames[id] || {fn: '', ln: `Player ${id}`};
    const playerName = (id) => {
        const p = playerInfo(id);
        if(p.pos == 'DEF') return `${p.fn} ${p.ln}`.trim() || `${id} D/ST`;
        return `${p.fn || ''} ${p.ln || ''}`.trim();
    };
    const possessive = (name) => name + (name.endsWith('s') ? '’' : '’s');
    const hideImg = (e) => { e.target.style.display = 'none'; };
    const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

    const assetLabel = (key) => {
        const a = history.assets[key];
        if(!a) return key;
        if(a.kind == 'player') return playerName(a.playerID);
        if(a.usedOn) return `${a.season} Pick ${a.usedOn.pickLabel}`;
        return `${a.season} ${ordinal(a.round)} Round`;
    };
    const assetSub = (key) => {
        const a = history.assets[key];
        if(!a) return '';
        if(a.kind == 'player') {
            const p = playerInfo(a.playerID);
            return [p.pos, p.t].filter(Boolean).join(' · ');
        }
        return `orig. ${teamName(a.original, a.season)}`;
    };
    const playerImg = (id) => {
        const p = playerInfo(id);
        if(p.pos == 'DEF') return `https://sleepercdn.com/images/team_logos/nfl/${String(id).toLowerCase()}.png`;
        return `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;
    };
    const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});

    // ---------- search index ----------
    const searchText = {};
    for(const key in history.assets) {
        const a = history.assets[key];
        if(a.kind == 'player') {
            searchText[key] = playerName(a.playerID).toLowerCase();
        } else {
            const parts = [
                `${a.season}`, `${a.season} round ${a.round}`, `${a.season} ${ordinal(a.round)}`, `round ${a.round}`,
                `${a.season} r${a.round}`, `pick`, teamName(a.original, a.season), currentTeamName(a.original),
            ];
            if(a.usedOn) parts.push(`${a.season} ${a.usedOn.pickLabel}`, playerName(history.assets[a.usedOn.player]?.playerID));
            searchText[key] = parts.join(' | ').toLowerCase();
        }
    }
    const rosterNamesText = {};
    for(const season in teamsMap) {
        for(const roster in teamsMap[season]) {
            rosterNamesText[roster] = ((rosterNamesText[roster] || '') + ' | ' + teamsMap[season][roster].team.name).toLowerCase();
        }
    }

    const matchesQuery = (ev, q) => {
        if(!q) return true;
        if(searchText[ev.asset]?.includes(q)) return true;
        if(ev.from != null && rosterNamesText[ev.from]?.includes(q)) return true;
        if(ev.to != null && rosterNamesText[ev.to]?.includes(q)) return true;
        return false;
    };
    const matchesType = (ev, t) => {
        if(t == 'all') return true;
        if(t == 'trade') return ev.type == 'trade' || ev.type == 'unrecorded';
        if(t == 'add') return ev.type == 'waiver' || ev.type == 'free_agent';
        if(t == 'draft') return ev.type == 'draft';
        return ev.type == t;
    };

    const allMoves = [...history.events].filter(ev => ev.type != 'pick_used').sort((a, b) => b.ts - a.ts);

    $: q = query.trim().toLowerCase();
    $: filteredMoves = allMoves.filter(ev =>
        (seasonFilter == 'all' || ev.season == seasonFilter) &&
        matchesType(ev, typeFilter) &&
        (teamFilter == 'all' || ev.from == teamFilter || ev.to == teamFilter) &&
        matchesQuery(ev, q)
    );
    $: (q, seasonFilter, typeFilter, teamFilter, shown = PAGE_SIZE);

    // quick asset suggestions while typing
    $: suggestions = q.length < 2 ? [] : Object.keys(searchText)
        .filter(k => searchText[k].includes(q))
        .sort((a, b) => {
            const aa = history.assets[a], bb = history.assets[b];
            // players first, then picks newest first; more history ranks higher
            if(aa.kind != bb.kind) return aa.kind == 'player' ? -1 : 1;
            if(aa.kind == 'pick') return bb.season - aa.season || aa.round - bb.round;
            return bb.events.length - aa.events.length;
        })
        .slice(0, 8);

    // ---------- selection / url ----------
    const syncUrl = () => {
        if(!browser) return;
        const url = new URL(window.location.href);
        url.searchParams.set('view', view);
        if(selected) url.searchParams.set('asset', selected); else url.searchParams.delete('asset');
        window.history.replaceState(window.history.state, '', url);
    };

    const select = async (key) => {
        if(!history.assets[key]) return;
        showSuggestions = false;
        selected = key;
        syncUrl();
        await tick();
        detailEl?.scrollIntoView({behavior: 'smooth', block: 'start'});
    };
    const clearSelection = () => { selected = null; syncUrl(); };
    const setView = (v) => { view = v; syncUrl(); };

    onMount(() => { if(selected) select(selected); });

    // ---------- detail ----------
    $: selectedAsset = selected ? history.assets[selected] : null;
    $: selectedEvents = selectedAsset ? selectedAsset.events.map(id => history.events[id]) : [];

    const tradeSides = (txID) => {
        const tx = history.transactions[txID];
        if(!tx) return [];
        return tx.rosters.map(r => ({
            roster: r,
            received: tx.moves.filter(m => m.to == r).map(m => m.asset),
            faab: tx.faab.filter(f => f.to == r).reduce((sum, f) => sum + f.amount, 0),
        }));
    };

    // ---------- pick board ----------
    $: boardPicks = history.rosterIDs.map(r => ({
        roster: r,
        rounds: [...Array(history.rounds).keys()].map(i => history.assets[`pick:${pickSeason}-${i + 1}-${r}`]),
    }));

    const teamsForFilter = history.rosterIDs.map(r => ({roster: r, name: currentTeamName(r)})).sort((a, b) => a.name.localeCompare(b.name));
</script>

<div class="assetHistory">
    <h1>Asset History</h1>
    <p class="intro">Every trade, waiver claim, free-agent signing, drop and draft selection across {history.seasons.length} seasons, for every player <em>and</em> every draft pick. Click any player or pick to see how it changed hands over time.</p>

    <div class="searchBar">
        <input type="search" placeholder="Search a player, pick (e.g. “2027 round 1”) or team…" bind:value={query} on:input={() => showSuggestions = true} on:focus={() => showSuggestions = true} on:keydown={(e) => { if(e.key == 'Escape') showSuggestions = false; if(e.key == 'Enter' && suggestions.length) select(suggestions[0]); }} aria-label="Search players, picks or teams" />
        {#if showSuggestions && suggestions.length}
            <div class="suggestions">
                {#each suggestions as key}
                    <button class="suggestion" on:click={() => { select(key); }}>
                        <span class="sugName">{assetLabel(key)}</span>
                        <span class="sugSub">{assetSub(key)}</span>
                    </button>
                {/each}
            </div>
        {/if}
    </div>

    {#if selectedAsset}
        <section class="detail" bind:this={detailEl}>
            <div class="detailHeader">
                {#if selectedAsset.kind == 'player'}
                    <div class="headshot" style="background-image: url({playerImg(selectedAsset.playerID)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)"></div>
                {:else}
                    <div class="pickBadge">R{selectedAsset.round}<span>{selectedAsset.season}</span></div>
                {/if}
                <div class="detailTitle">
                    <h2>{assetLabel(selected)}{#if selectedAsset.kind == 'pick' && selectedAsset.usedOn}<span class="roundNote"> ({ordinal(selectedAsset.round)} Round)</span>{/if}</h2>
                    <div class="detailMeta">
                        {#if selectedAsset.kind == 'player'}
                            {assetSub(selected)}
                            {#if selectedAsset.owner != null}
                                · Currently on <strong>{currentTeamName(selectedAsset.owner)}</strong>
                            {:else}
                                · Not currently rostered
                            {/if}
                        {:else}
                            Originally <TeamName roster={selectedAsset.original} season={selectedAsset.season} {leagueTeamManagers} possessive /> pick
                            {#if selectedAsset.usedOn}
                                · Used by <TeamName roster={selectedAsset.usedOn.roster} season={selectedAsset.season} {leagueTeamManagers} /> on
                                <button class="link" on:click={() => select(selectedAsset.usedOn.player)}>{assetLabel(selectedAsset.usedOn.player)}</button>
                            {:else}
                                · Owned by <strong>{currentTeamName(selectedAsset.owner)}</strong>
                            {/if}
                            · {selectedAsset.trades} {selectedAsset.trades == 1 ? 'trade' : 'trades'}
                        {/if}
                    </div>
                </div>
                <button class="close" on:click={clearSelection} aria-label="Close">✕</button>
            </div>

            <ol class="timeline">
                {#if selectedAsset.kind == 'pick'}
                    <li class="tl created">
                        <div class="tlDot"></div>
                        <div class="tlBody">
                            <div class="tlTitle">Pick created for <TeamName roster={selectedAsset.original} season={selectedAsset.season} {leagueTeamManagers} /></div>
                        </div>
                    </li>
                {/if}
                {#each selectedEvents as ev (ev.id)}
                    <li class="tl {ev.type}">
                        <div class="tlDot"></div>
                        <div class="tlBody">
                            <div class="tlDate">{fmtDate(ev.ts)} · {ev.season} season</div>
                            <div class="tlTitle">
                                {#if ev.type == 'draft'}
                                    Drafted by <TeamName roster={ev.to} season={ev.season} {leagueTeamManagers} /> at {ev.pickLabel} in the {ev.draftName}
                                    {#if ev.linked}
                                        using <button class="link" on:click={() => select(ev.linked)}>{possessive(teamName(history.assets[ev.linked].original, ev.season))} {ordinal(history.assets[ev.linked].round)}-round pick</button>
                                    {/if}
                                {:else if ev.type == 'pick_used'}
                                    <TeamName roster={ev.roster} season={ev.season} {leagueTeamManagers} /> used it at {ev.pickLabel} to select
                                    <button class="link" on:click={() => select(ev.linked)}>{assetLabel(ev.linked)}</button>
                                {:else if ev.type == 'trade'}
                                    Traded from <TeamName roster={ev.from} season={ev.season} {leagueTeamManagers} /> to <TeamName roster={ev.to} season={ev.season} {leagueTeamManagers} />
                                {:else if ev.type == 'unrecorded'}
                                    Moved from <TeamName roster={ev.from} season={ev.season} {leagueTeamManagers} /> to <TeamName roster={ev.to} season={ev.season} {leagueTeamManagers} />
                                    <div class="note">Sleeper has no transaction record for this trade (it was probably made inside the startup draft room), so the date is approximate.</div>
                                {:else if ev.type == 'waiver'}
                                    Claimed off waivers by <TeamName roster={ev.to} season={ev.season} {leagueTeamManagers} />{#if ev.bid != null} for <span class="faab">${ev.bid} FAAB</span>{/if}
                                {:else if ev.type == 'free_agent'}
                                    Signed as a free agent by <TeamName roster={ev.to} season={ev.season} {leagueTeamManagers} />
                                {:else if ev.type == 'drop'}
                                    Released by <TeamName roster={ev.from} season={ev.season} {leagueTeamManagers} />
                                {:else if ev.type == 'commissioner'}
                                    Commissioner move:
                                    {#if ev.from != null && ev.to != null}
                                        <TeamName roster={ev.from} season={ev.season} {leagueTeamManagers} /> → <TeamName roster={ev.to} season={ev.season} {leagueTeamManagers} />
                                    {:else if ev.to != null}
                                        added to <TeamName roster={ev.to} season={ev.season} {leagueTeamManagers} />
                                    {:else}
                                        removed from <TeamName roster={ev.from} season={ev.season} {leagueTeamManagers} />
                                    {/if}
                                {/if}
                            </div>
                            {#if ev.type == 'trade' && ev.tx}
                                <div class="tradeBox">
                                    {#each tradeSides(ev.tx) as side}
                                        <div class="tradeSide">
                                            <div class="tradeTeam">
                                                {#if team(side.roster, ev.season).avatar}<img src={team(side.roster, ev.season).avatar} alt="" class="avatar" on:error={hideImg} />{/if}
                                                <span>{teamName(side.roster, ev.season)} received</span>
                                            </div>
                                            <ul>
                                                {#each side.received as key}
                                                    <li>
                                                        {#if key == selected}
                                                            <strong>{assetLabel(key)}</strong>
                                                        {:else}
                                                            <button class="link" on:click={() => select(key)}>{assetLabel(key)}</button>
                                                        {/if}
                                                        <span class="small">{assetSub(key)}</span>
                                                    </li>
                                                {/each}
                                                {#if side.faab}<li><span class="faab">${side.faab} FAAB</span></li>{/if}
                                                {#if !side.received.length && !side.faab}<li class="small">nothing</li>{/if}
                                            </ul>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </li>
                {/each}
                {#if selectedAsset.kind == 'player' && !selectedEvents.length}
                    <li class="tl"><div class="tlDot"></div><div class="tlBody"><div class="tlTitle">No moves recorded.</div></div></li>
                {/if}
            </ol>
        </section>
    {/if}

    <div class="viewTabs" role="tablist">
        <button role="tab" class:active={view == 'moves'} aria-selected={view == 'moves'} on:click={() => setView('moves')}>All moves</button>
        <button role="tab" class:active={view == 'picks'} aria-selected={view == 'picks'} on:click={() => setView('picks')}>Draft pick board</button>
    </div>

    {#if view == 'moves'}
        <div class="filters">
            <select bind:value={seasonFilter} aria-label="Season">
                <option value="all">All seasons</option>
                {#each history.seasons as s}<option value={s}>{s}</option>{/each}
            </select>
            <select bind:value={typeFilter} aria-label="Move type">
                {#each typeFilters as [v, l]}<option value={v}>{l}</option>{/each}
            </select>
            <select bind:value={teamFilter} aria-label="Team">
                <option value="all">All teams</option>
                {#each teamsForFilter as t}<option value={t.roster}>{t.name}</option>{/each}
            </select>
            <span class="count">{filteredMoves.length.toLocaleString()} moves</span>
        </div>

        <div class="tableWrap">
            <table class="moves">
                <thead>
                    <tr><th>Date</th><th>Type</th><th>Asset</th><th>From</th><th>To</th><th>Details</th></tr>
                </thead>
                <tbody>
                    {#each filteredMoves.slice(0, shown) as ev (ev.id)}
                        <tr>
                            <td class="date">{fmtDate(ev.ts)}</td>
                            <td><span class="badge {ev.type}">{typeLabels[ev.type]}</span></td>
                            <td class="asset">
                                <button class="link" on:click={() => select(ev.asset)}>{assetLabel(ev.asset)}</button>
                                <span class="small">{assetSub(ev.asset)}</span>
                            </td>
                            <td>{ev.from != null ? teamName(ev.from, ev.season) : '—'}</td>
                            <td>{ev.to != null ? teamName(ev.to, ev.season) : '—'}</td>
                            <td class="small">
                                {#if ev.type == 'waiver' && ev.bid != null}${ev.bid} FAAB{/if}
                                {#if ev.type == 'draft'}{ev.draftName} · {ev.pickLabel}{/if}
                                {#if ev.type == 'trade' && ev.tx}{history.transactions[ev.tx]?.moves.length} assets moved{/if}
                                {#if ev.type == 'unrecorded'}not in Sleeper log{/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        {#if filteredMoves.length > shown}
            <button class="more" on:click={() => shown += PAGE_SIZE}>Show more ({(filteredMoves.length - shown).toLocaleString()} remaining)</button>
        {/if}
        {#if !filteredMoves.length}
            <p class="empty">No moves match those filters.</p>
        {/if}
    {:else}
        <div class="filters">
            <select bind:value={pickSeason} aria-label="Draft season">
                {#each history.pickSeasons as s}<option value={s}>{s} draft{s > history.currentSeason || !history.assets[`pick:${s}-1-${history.rosterIDs[0]}`]?.usedOn ? ' (future)' : ''}</option>{/each}
            </select>
            <span class="count">Rows are each pick's original owner. Cells show who owns (or used) it.</span>
        </div>
        <div class="tableWrap">
            <table class="board">
                <thead>
                    <tr>
                        <th>Original owner</th>
                        {#each [...Array(history.rounds).keys()] as i}<th>Round {i + 1}</th>{/each}
                    </tr>
                </thead>
                <tbody>
                    {#each boardPicks as row}
                        <tr>
                            <th class="rowTeam">{teamName(row.roster, pickSeason)}</th>
                            {#each row.rounds as pick}
                                <td>
                                    {#if pick}
                                        <button class="cell" class:moved={(pick.usedOn ? pick.usedOn.roster : pick.owner) != pick.original} on:click={() => select(pick.key)}>
                                            {#if pick.usedOn}
                                                <span class="cellMain">{pick.usedOn.pickLabel} · {assetLabel(pick.usedOn.player)}</span>
                                                <span class="cellSub">by {teamName(pick.usedOn.roster, pick.season)}</span>
                                            {:else}
                                                <span class="cellMain">{currentTeamName(pick.owner)}</span>
                                                <span class="cellSub">{pick.owner == pick.original ? 'still with original owner' : 'current owner'}</span>
                                            {/if}
                                            {#if pick.trades}<span class="trades">{pick.trades}× traded</span>{/if}
                                        </button>
                                    {/if}
                                </td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

<style>
    .assetHistory {
        color: var(--g111, inherit);
    }
    h1 {
        text-align: center;
        margin: 0.2em 0;
    }
    .intro {
        text-align: center;
        color: var(--g555, #555);
        max-width: 640px;
        margin: 0 auto 1.2em;
        line-height: 1.4;
    }
    .searchBar {
        position: relative;
        max-width: 640px;
        margin: 0 auto 1.2em;
    }
    input[type=search] {
        width: 100%;
        box-sizing: border-box;
        font-size: 1em;
        padding: 0.7em 1em;
        border: 2px solid var(--blueOne);
        border-radius: 8px;
        background: var(--fff);
        color: inherit;
    }
    .suggestions {
        position: absolute;
        z-index: 5;
        left: 0;
        right: 0;
        top: 100%;
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-radius: 0 0 8px 8px;
        box-shadow: 0 6px 16px rgba(0,0,0,0.15);
        overflow: hidden;
    }
    .suggestion {
        display: flex;
        width: 100%;
        justify-content: space-between;
        gap: 1em;
        padding: 0.55em 1em;
        border: none;
        border-bottom: 1px solid var(--eee);
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }
    .suggestion:hover, .suggestion:focus {
        background: var(--headerPrimary);
    }
    .sugSub, .small {
        color: var(--g999, #999);
        font-size: 0.8em;
    }
    .small { margin-left: 0.3em; }

    /* detail */
    .detail {
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-top: 4px solid var(--blueOne);
        border-radius: 8px;
        padding: 1em 1.2em;
        margin-bottom: 1.5em;
        scroll-margin-top: 80px;
    }
    .detailHeader {
        display: flex;
        align-items: center;
        gap: 1em;
    }
    .headshot {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        border-radius: 50%;
        background-size: cover;
        background-position: center;
        background-color: var(--eee);
        border: 2px solid var(--aaa);
    }
    .pickBadge {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        border-radius: 50%;
        background: var(--PICKSfade, #73b647);
        color: #fff;
        font-weight: bold;
        font-size: 1.3em;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        line-height: 1;
    }
    .pickBadge span {
        font-size: 0.55em;
        font-weight: normal;
        margin-top: 2px;
    }
    .detailTitle {
        flex-grow: 1;
        min-width: 0;
    }
    .detailTitle h2 {
        margin: 0 0 0.2em;
        font-size: 1.4em;
    }
    .roundNote {
        font-size: 0.65em;
        color: var(--g999, #999);
        font-weight: normal;
    }
    .detailMeta {
        font-size: 0.9em;
        line-height: 1.5;
    }
    .close {
        align-self: flex-start;
        border: none;
        background: none;
        color: inherit;
        font-size: 1.2em;
        cursor: pointer;
        padding: 0.2em 0.4em;
    }

    .timeline {
        list-style: none;
        padding: 0;
        margin: 1.2em 0 0;
    }
    .tl {
        position: relative;
        display: flex;
        gap: 0.9em;
        padding-bottom: 1.1em;
    }
    .tl:not(:last-child)::before {
        content: '';
        position: absolute;
        left: 6px;
        top: 16px;
        bottom: 0;
        width: 2px;
        background: var(--ddd);
    }
    .tlDot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        flex-shrink: 0;
        margin-top: 3px;
        background: var(--aaa);
    }
    .tl.trade .tlDot, .tl.unrecorded .tlDot { background: var(--blueTwo); }
    .tl.waiver .tlDot, .tl.free_agent .tlDot { background: #2e9e5b; }
    .tl.drop .tlDot { background: #d64545; }
    .tl.draft .tlDot, .tl.pick_used .tlDot, .tl.created .tlDot { background: var(--PICKSfade, #73b647); }
    .tl.commissioner .tlDot { background: #b07b00; }
    .tlBody {
        flex-grow: 1;
        min-width: 0;
    }
    .tlDate {
        font-size: 0.75em;
        color: var(--g999, #999);
    }
    .tlTitle {
        line-height: 1.4;
    }
    .note {
        font-size: 0.8em;
        color: var(--g999, #999);
        font-style: italic;
    }
    .tradeBox {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6em;
        margin-top: 0.5em;
    }
    .tradeSide {
        flex: 1 1 200px;
        background: var(--transactHeader);
        border: 1px solid var(--ddd);
        border-radius: 6px;
        padding: 0.5em 0.7em;
        font-size: 0.9em;
    }
    .tradeTeam {
        font-weight: bold;
        display: flex;
        align-items: center;
        gap: 0.4em;
        margin-bottom: 0.3em;
    }
    .avatar {
        width: 22px;
        height: 22px;
        border-radius: 50%;
    }
    .tradeSide ul {
        margin: 0;
        padding-left: 1.2em;
    }
    .faab {
        color: var(--Budget, #7947d4);
        font-weight: bold;
    }

    .link {
        border: none;
        background: none;
        padding: 0;
        font: inherit;
        color: var(--blueTwo);
        cursor: pointer;
        text-align: left;
    }
    .link:hover { text-decoration: underline; }

    /* tabs + filters */
    .viewTabs {
        display: flex;
        gap: 0.5em;
        border-bottom: 2px solid var(--blueOne);
        margin-bottom: 0.8em;
    }
    .viewTabs button {
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        padding: 0.6em 1em;
        cursor: pointer;
        border-radius: 6px 6px 0 0;
    }
    .viewTabs button.active {
        background: var(--blueOne);
        color: #fff;
    }
    .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5em;
        margin-bottom: 0.8em;
    }
    .filters select {
        font: inherit;
        padding: 0.4em 0.5em;
        border: 1px solid var(--ddd);
        border-radius: 6px;
        background: var(--fff);
        color: inherit;
    }
    .count {
        font-size: 0.85em;
        color: var(--g999, #999);
    }

    .tableWrap {
        overflow-x: auto;
        background: var(--fff);
        border: 1px solid var(--ddd);
        border-radius: 8px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9em;
    }
    th, td {
        padding: 0.5em 0.6em;
        text-align: left;
        border-bottom: 1px solid var(--eee);
        vertical-align: top;
    }
    thead th {
        background: var(--headerPrimary);
        white-space: nowrap;
    }
    .date { white-space: nowrap; }
    .asset { min-width: 150px; }
    .badge {
        display: inline-block;
        font-size: 0.75em;
        padding: 0.15em 0.5em;
        border-radius: 10px;
        white-space: nowrap;
        background: var(--eee);
        color: #333;
    }
    .badge.trade, .badge.unrecorded { background: #d6ebff; color: #00316b; }
    .badge.waiver, .badge.free_agent { background: var(--waiverAdd, #e9fff1); color: #1d6b3d; }
    .badge.drop { background: var(--waiverDrop, #ffe9e9); color: #9a2323; }
    .badge.draft { background: #e7f4dc; color: #3f6b1f; }
    .badge.commissioner { background: #fff1cc; color: #7a5600; }
    .more {
        display: block;
        margin: 1em auto;
        font: inherit;
        padding: 0.5em 1.2em;
        border: 1px solid var(--blueOne);
        border-radius: 6px;
        background: var(--fff);
        color: inherit;
        cursor: pointer;
    }
    .empty {
        text-align: center;
        color: var(--g999, #999);
    }

    .board td {
        padding: 0.3em;
        min-width: 140px;
    }
    .rowTeam {
        white-space: nowrap;
        font-weight: bold;
        vertical-align: middle;
    }
    .cell {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        text-align: left;
        border: 1px solid var(--ddd);
        border-radius: 6px;
        background: var(--fff);
        color: inherit;
        font: inherit;
        padding: 0.4em 0.5em;
        cursor: pointer;
    }
    .cell:hover { border-color: var(--blueTwo); }
    .cell.moved {
        background: var(--draftSwapped);
        border-left: 4px solid var(--blueTwo);
    }
    .cellMain { font-weight: bold; }
    .cellSub { font-size: 0.78em; color: var(--g999, #999); }
    .trades {
        font-size: 0.72em;
        background: #d6ebff;
        color: #00316b;
        border-radius: 8px;
        padding: 0 0.45em;
    }

    @media (max-width: 600px) {
        .detail { padding: 0.8em; }
        .detailHeader { flex-wrap: wrap; align-items: flex-start; }
        .detailTitle { flex-basis: 100%; order: 3; }
        .headshot, .pickBadge { width: 48px; height: 48px; }
        .detailTitle h2 { font-size: 1.15em; }
        table { font-size: 0.8em; }
    }
</style>
