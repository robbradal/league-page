<script>
    // Team name as it was in `season`, plus the current name when the team has since been renamed
    export let roster, season, leagueTeamManagers, possessive = false;

    const lookup = (year) => {
        const map = leagueTeamManagers.teamManagersMap;
        if(!year || year > leagueTeamManagers.currentSeason || !map[year]) year = leagueTeamManagers.currentSeason;
        return map[year]?.[roster]?.team?.name || map[leagueTeamManagers.currentSeason]?.[roster]?.team?.name || `Team ${roster}`;
    };
    $: then = lookup(season).trim();
    $: now = lookup(leagueTeamManagers.currentSeason).trim();
    $: suffix = possessive ? (then.endsWith('s') ? '’' : '’s') : '';
</script>

<strong>{then}{suffix}</strong>{#if then != now}<span class="now"> (now {now})</span>{/if}

<style>
    .now {
        margin-left: 0.25em;
        font-size: 0.8em;
        color: var(--g999, #999);
        font-weight: normal;
    }
</style>
