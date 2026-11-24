<script>
	import LinearProgress from '@smui/linear-progress';
	import { AssetHistory } from '$lib/components';
	import { waitForAll } from '$lib/utils/helper';

	export let data;
	const { historyData, playersData, leagueTeamManagersData, asset, view } = data;
</script>

<style>
	#main {
		position: relative;
		z-index: 1;
		display: block;
		margin: 30px auto;
		width: 95%;
		max-width: 1100px;
	}

	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
	}
</style>

<div id="main">
	{#await waitForAll(historyData, playersData, leagueTeamManagersData)}
		<div class="loading">
			<p>Loading every trade, waiver and draft pick in league history...</p>
			<LinearProgress indeterminate />
		</div>
	{:then [history, playersInfo, leagueTeamManagers]}
		<AssetHistory {history} players={playersInfo.players} {leagueTeamManagers} initialAsset={asset} initialView={view} />
	{:catch error}
		<p class="center">Something went wrong: {error.message}</p>
	{/await}
</div>
