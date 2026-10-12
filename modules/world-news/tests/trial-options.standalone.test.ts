import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrialOptions } from '../verification/trial-options.ts';

test('real trial accepts the current Docker port and explicit existing material order', () => {
  const result = parseTrialOptions(['--execute-paid-trial', '--articles=first,second'], 'postgres://postgres@127.0.0.1:54512/world_real_trial_test');
  assert.deepEqual(result.articleIds, ['first','second']);
  assert.equal(result.target.port, '54512');
  assert.equal(parseTrialOptions(['--execute-paid-trial'], 'postgres://127.0.0.1:59051/world_real_trial_test').articleIds, undefined);
});

test('paid opt-in, exact database, local host and distinct bounded identities remain required', () => {
  const url = 'postgres://127.0.0.1:54512/world_real_trial_test';
  for (const args of [[], ['--execute-paid-trial','--unknown'], ['--execute-paid-trial','--articles='],
    ['--execute-paid-trial','--articles=a,a'], ['--execute-paid-trial','--articles=a,b,c,d,e'],
    ['--execute-paid-trial','--articles=a','--articles=b']]) assert.throws(() => parseTrialOptions(args,url));
  for (const wrong of ['postgres://example.com:54512/world_real_trial_test', 'postgres://127.0.0.1:54512/aihot',
    'postgres://127.0.0.1/world_real_trial_test']) assert.throws(() => parseTrialOptions(['--execute-paid-trial'],wrong));
});
