export function parseTrialOptions(args: readonly string[], databaseUrl: string) {
  const target = new URL(databaseUrl);
  if (target.hostname !== '127.0.0.1' || !target.port || target.pathname !== '/world_real_trial_test')
    throw new Error('Use the dedicated local world_real_trial_test Docker database and its current mapped port');
  if (args.filter(arg => arg === '--execute-paid-trial').length !== 1)
    throw new Error('Pass --execute-paid-trial only for the approved <=5 CNY trial');
  if (args.some(arg => arg !== '--execute-paid-trial' && !arg.startsWith('--articles=')))
    throw new Error('Unknown trial argument');
  const explicit = args.filter(arg => arg.startsWith('--articles='));
  if (explicit.length > 1) throw new Error('Specify --articles once');
  const articleIds = explicit[0]?.slice('--articles='.length).split(',');
  if (articleIds && (articleIds.length > 4 || articleIds.some(id => !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) ||
    new Set(articleIds).size !== articleIds.length)) throw new Error('Provide one to four distinct article identities');
  return { target, articleIds };
}
