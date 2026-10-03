const { Client } = require('pg');
const fs = require('fs');
const dir = require('path').join(__dirname, '..') + '/';
const PG = { host: process.env.PGHOST || '/tmp', port: +(process.env.PGPORT || 5433), user: process.env.PGUSER || 'postgres' };
let pass = 0, failures = [];
const ok = (name, cond) => { cond ? pass++ : failures.push(name); };

(async () => {
  const admin = new Client({ ...PG, database: 'postgres' });
  await admin.connect();
  await admin.query('drop database if exists family_tasks_test'); await admin.query('create database family_tasks_test');
  await admin.end();
  const db = new Client({ ...PG, database: 'family_tasks_test' });
  await db.connect();
  await db.query(fs.readFileSync(dir + 'tests/supabase-stub.sql', 'utf8'));
  await db.query(fs.readFileSync(dir + 'schema.sql', 'utf8'));
  for (const m of fs.readdirSync(dir + 'migrations').sort()) {
    await db.query(fs.readFileSync(dir + 'migrations/' + m, 'utf8'));
  }

  const users = {};
  const mkUser = async (name, anon = false) => {
    const { rows } = await db.query('insert into auth.users(id, email, is_anonymous) values (gen_random_uuid(), $2, $1) returning id',
      [anon, anon ? null : `${name.toLowerCase()}@example.com`]);
    users[name] = { id: rows[0].id, anon };
  };
  // Run SQL as a user through PostgREST-equivalent role + claims. Returns {rows} or {error}.
  const as = async (name, sql, params = [], role = 'authenticated') => {
    await db.query('begin');
    try {
      const claims = name ? JSON.stringify({ sub: users[name].id, is_anonymous: users[name].anon }) : '';
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await db.query(`set local role ${role}`);
      const r = await db.query(sql, params);
      await db.query('commit'); return { rows: r.rows };
    } catch (e) { await db.query('rollback'); return { error: e.message }; }
  };
  const err = (r) => r.error || '';

  for (const u of ['dad', 'mom', 'other']) await mkUser(u);
  for (const u of ['ariaPhone', 'samPhone', 'stranger']) await mkUser(u, true);

  // Family creation
  ok('anon cannot create family', err(await as('stranger', `select create_family('X','Y','America/Toronto')`)).includes('email_account_required'));
  ok('bad timezone rejected', err(await as('dad', `select create_family('Abbasi','Dad','Mars/Base')`)).includes('invalid_timezone'));
  const fam = (await as('dad', `select create_family('Abbasi','Dad','America/Toronto') f`)).rows[0].f;
  ok('family created', !!fam);
  ok('cannot create second family', err(await as('dad', `select create_family('B','Dad','America/Toronto')`)).includes('already_in_family'));
  await as('other', `select create_family('Other','C','Europe/London')`);

  // Children + invites
  const aria = (await as('dad', `select add_child('Aria') c`)).rows[0].c;
  const sam = (await as('dad', `select add_child('Sam') c`)).rows[0].c;
  ok('non-parent cannot add child', err(await as('stranger', `select add_child('X')`)).includes('parents_only'));
  const pCode = (await as('dad', `select create_invite('parent') c`)).rows[0].c;
  ok('anon cannot use parent invite', err(await as('stranger', `select accept_invite($1,'X')`, [pCode])).includes('email_account_required'));
  ok('mom joins as parent', !(await as('mom', `select accept_invite($1,'Mom')`, [pCode])).error);
  await mkUser('mom2');
  ok('invite single-use', err(await as('mom2', `select accept_invite($1,'Mom2')`, [pCode])).includes('invite_invalid'));
  ok('plaintext code not stored', (await db.query(`select count(*)::int n from invites where code_hash = $1`, [pCode])).rows[0].n === 0);
  ok('other family cannot invite for our child', err(await as('other', `select create_invite('child_device',$1)`, [aria])).includes('child_not_found'));
  const aCode = (await as('dad', `select create_invite('child_device',$1) c`, [aria])).rows[0].c;
  const sCode = (await as('mom', `select create_invite('child_device',$1) c`, [sam])).rows[0].c;
  ok('aria phone links', !(await as('ariaPhone', `select accept_invite($1)`, [aCode])).error);
  ok('sam phone links', !(await as('samPhone', `select accept_invite(lower($1))`, [sCode])).error);

  // Direct writes are blocked despite Supabase-style default grants
  ok('no direct insert into tasks', err(await as('dad', `insert into tasks(family_id,title,days_mask,time_local,starts_on) values ($1,'x',1,'10:00',current_date)`, [fam])).includes('permission denied'));
  ok('no direct update of results', err(await as('ariaPhone', `update task_results set state='done'`)).includes('permission denied'));
  ok('anon role reads nothing', err(await as(null, `select * from families`, [], 'anon')).includes('permission denied'));
  ok('cannot call private helpers directly as anon', err(await as(null, `select private.parent_family()`, [], 'anon')).includes('permission denied'));
  ok('claim_due_reminders not callable by users', err(await as('dad', `select * from claim_due_reminders()`)).includes('permission denied'));

  // Tasks
  const otherKid = (await as('other', `select add_child('Zed') c`)).rows[0].c;
  ok('cannot assign another family child', err(await as('dad', `select save_task(null,'Hack','10:00',127,true,array[$1]::uuid[])`, [otherKid])).includes('child_not_found'));
  ok('assignee required', err(await as('dad', `select save_task(null,'X','10:00',127,true,'{}')`)).includes('assignee_required'));
  const piano = (await as('dad', `select save_task(null,'Piano','17:00',127,true,array[$1]::uuid[]) t`, [aria])).rows[0].t;
  const both = (await as('mom', `select save_task(null,'Reading','19:00',127,true,array[$1,$2]::uuid[]) t`, [aria, sam])).rows[0].t;
  ok('child cannot save task', err(await as('ariaPhone', `select save_task(null,'X','10:00',1,true,array[$1]::uuid[])`, [aria])).includes('parents_only'));

  // Visibility / isolation
  const count = async (u, sql, p = []) => (await as(u, sql, p)).rows?.[0]?.n;
  ok('aria sees 2 tasks', await count('ariaPhone', `select count(*)::int n from tasks`) === 2);
  ok('sam sees 1 task', await count('samPhone', `select count(*)::int n from tasks`) === 1);
  ok('sam sees only himself', await count('samPhone', `select count(*)::int n from children`) === 1);
  ok('other family sees none of ours', await count('other', `select count(*)::int n from tasks where family_id = $1`, [fam]) === 0);
  ok('stranger sees nothing', await count('stranger', `select count(*)::int n from families`) === 0);

  // Results
  const today = (await db.query(`select (now() at time zone 'America/Toronto')::date::text d`)).rows[0].d;
  ok('aria reports done', !(await as('ariaPhone', `select submit_result($1,$2,$3::date,'done','')`, [piano, aria, today])).error);
  ok('aria re-reports (upsert)', !(await as('ariaPhone', `select submit_result($1,$2,$3::date,'help','stuck on scales')`, [piano, aria, today])).error);
  ok('upsert kept one row', (await db.query(`select count(*)::int n from task_results`)).rows[0].n === 1);
  ok('cannot report for sibling', err(await as('ariaPhone', `select submit_result($1,$2,$3::date,'done','')`, [both, sam, today])).includes('not_allowed'));
  ok('sam cannot report unassigned task', err(await as('samPhone', `select submit_result($1,$2,$3::date,'done','')`, [piano, sam, today])).includes('not_assigned'));
  ok('no future dates', err(await as('ariaPhone', `select submit_result($1,$2,($3::date+1),'done','')`, [piano, aria, today])).includes('date_in_future'));
  ok('not before task start', err(await as('ariaPhone', `select submit_result($1,$2,($3::date-1),'done','')`, [piano, aria, today])).includes('not_scheduled'));
  ok('parent records on behalf', !(await as('mom', `select submit_result($1,$2,$3::date,'not_done','')`, [both, sam, today])).error);
  ok('other family parent blocked', err(await as('other', `select submit_result($1,$2,$3::date,'done','')`, [piano, aria, today])).includes('not_allowed'));
  ok('sam cannot see aria results', await count('samPhone', `select count(*)::int n from task_results where child_id = $1`, [aria]) === 0);
  ok('parents see all results', await count('dad', `select count(*)::int n from task_results`) === 2);

  // Unassigning keeps history
  await as('dad', `select save_task($1,'Reading','19:00',127,true,array[$2]::uuid[])`, [both, aria]);
  ok('unassign keeps results', await count('dad', `select count(*)::int n from task_results where child_id = $1`, [sam]) === 1);

  // Device removal
  const ariaPhoneId = users.ariaPhone.id;
  ok('remove lost phone', !(await as('dad', `select remove_child_device($1)`, [ariaPhoneId])).error);
  ok('removed phone sees nothing', await count('ariaPhone', `select count(*)::int n from tasks`) === 0);
  await mkUser('ariaPhone2', true);
  const a2 = (await as('dad', `select create_invite('child_device',$1) c`, [aria])).rows[0].c;
  await as('ariaPhone2', `select accept_invite($1)`, [a2]);
  ok('new phone keeps aria history', await count('ariaPhone2', `select count(*)::int n from task_results`) === 1);

  // Push subscriptions
  ok('save push', !(await as('ariaPhone2', `select save_push_subscription('https://push.example/abc','k','a')`)).error);
  ok('non-https endpoint rejected', !!(await as('ariaPhone2', `select save_push_subscription('http://evil/x','k','a')`)).error);
  ok('cannot read others push', await count('dad', `select count(*)::int n from push_subscriptions`) === 0);

  // Invite codes tolerate dashes, spaces and lowercase
  await mkUser('samTablet', true);
  const tCode = (await as('mom', `select create_invite('child_device',$1) c`, [sam])).rows[0].c;
  const messy = ' ' + tCode.toLowerCase().match(/.{1,4}/g).join('-') + ' ';
  ok('typed code with dashes accepted', !(await as('samTablet', `select accept_invite($1)`, [messy])).error);

  // Help alerts to parents
  await as('dad', `select save_push_subscription('https://push.example/dad','k','a')`);
  ok('child asks for help', !(await as('ariaPhone2', `select submit_result($1,$2,$3::date,'help','')`, [piano, aria, today])).error);
  const teeth = (await as('mom', `select save_task(null,'Teeth','08:00',127,true,array[$1]::uuid[]) t`, [sam])).rows[0].t;
  await as('mom', `select submit_result($1,$2,$3::date,'help','')`, [teeth, sam, today]);
  const alertCount = async () => (await db.query(`select count(*)::int n from private.parent_alerts`)).rows[0].n;
  ok('help creates one alert; parent-recorded help does not', await alertCount() === 1);
  await as('ariaPhone2', `select submit_result($1,$2,$3::date,'help','again')`, [piano, aria, today]);
  ok('repeat help same day does not duplicate', await alertCount() === 1);
  ok('users cannot claim alerts', err(await as('dad', `select * from claim_parent_alerts()`)).includes('permission denied'));
  const claimAlerts = async () => (await as(null, `select * from claim_parent_alerts()`, [], 'service_role')).rows;
  const a1 = await claimAlerts();
  ok('alert goes to parent endpoint only', a1.length === 1 && a1[0].endpoint === 'https://push.example/dad' && a1[0].child_name === 'Aria' && a1[0].title === 'Piano');
  ok('claimed alert not re-sent immediately', (await claimAlerts()).length === 0);
  await db.query(`update private.parent_alerts set claimed_at = now() - interval '3 minutes'`);
  ok('undelivered alert retried', (await claimAlerts()).length === 1);
  await as(null, `select complete_parent_alerts($1::bigint[])`, [[a1[0].alert_id]], 'service_role');
  await db.query(`update private.parent_alerts set claimed_at = now() - interval '3 minutes'`);
  ok('completed alert not retried', (await claimAlerts()).length === 0);

  // Deleting an account that is not the last parent keeps the family
  ok('mom deletes her account', !(await as('mom', `select delete_my_account()`)).error);
  ok('family survives non-last parent leaving', (await db.query(`select count(*)::int n from families where id=$1`, [fam])).rows[0].n === 1);
  ok('mom login removed', (await db.query(`select count(*)::int n from auth.users where id=$1`, [users.mom.id])).rows[0].n === 0);

  // Password recovery codes
  ok('anon cannot create recovery code', err(await as('samTablet', `select create_recovery_code()`)).includes('email_account_required'));
  ok('no recovery code yet', (await as('dad', `select has_recovery_code() h`)).rows[0].h === false);
  const rc = (await as('dad', `select create_recovery_code() c`)).rows[0].c;
  ok('recovery code created', /^[0-9A-F]{32}$/.test(rc) && (await as('dad', `select has_recovery_code() h`)).rows[0].h === true);
  ok('recovery code stored hashed', (await db.query(`select count(*)::int n from private.recovery_codes where code_hash = $1`, [rc])).rows[0].n === 0);
  ok('users cannot redeem codes directly', err(await as('dad', `select find_recovery_user('dad@example.com', $1)`, [rc])).includes('permission denied'));
  const find = async (email, code) => (await as(null, `select find_recovery_user($1,$2) u`, [email, code], 'service_role')).rows[0].u;
  ok('right email + code finds user', await find(' DAD@example.com ', rc.toLowerCase().match(/.{4}/g).join('-')) === users.dad.id);
  ok('wrong code finds nobody', await find('dad@example.com', rc.replace(/.$/, rc.endsWith('0') ? '1' : '0')) === null);
  ok('code is not valid for another email', await find('mom2@example.com', rc) === null);
  const rc2 = (await as(null, `select replace_recovery_code($1) c`, [users.dad.id], 'service_role')).rows[0].c;
  ok('old code stops working after reset', await find('dad@example.com', rc) === null && await find('dad@example.com', rc2) === users.dad.id);

  // ── Features: one-time tasks, points, review, rewards, photos, streaks, buttons ──
  const plus = (n) => (n >= 0 ? `+ ${n}` : `- ${-n}`);
  const famDay = (n) => db.query(`select ((now() at time zone 'America/Toronto')::date ${plus(n)})::text d`).then(r => r.rows[0].d);
  const save = (who, title, extra = {}, kids = [aria]) => as(who,
    `select save_task(null,$1,'16:00',$2,true,$3::uuid[],$4,$5::date,$6,$7,$8,$9::text[]) t`,
    [title, extra.kind === 'once' ? 0 : 127, kids, extra.kind ?? 'repeat', extra.due ?? null,
     extra.points ?? 0, extra.check ?? false, extra.photo ?? false, extra.list ?? []]);
  const submit = (who, task, date, state = 'done', photo = null) =>
    as(who, `select submit_result($1,$2,$3::date,$4,'',$5)`, [task, aria, date, state, photo]);
  const stats = async (who) => (await as(who, `select * from child_stats()`)).rows;

  ok('once task needs a date', err(await save('dad', 'X', { kind: 'once' })).includes('due_date_required'));
  const dentist = (await save('dad', 'Dentist', { kind: 'once', due: await famDay(2), points: 5 })).rows[0].t;
  ok('once task not due on other days', err(await submit('ariaPhone2', dentist, await famDay(0))).includes('not_scheduled'));
  ok('once task can be done early', !(await submit('ariaPhone2', dentist, await famDay(2))).error);
  const book = (await save('dad', 'Return library book', { kind: 'once', due: await famDay(-20) })).rows[0].t;
  ok('late once task can still be done (no 14-day limit)', !(await submit('ariaPhone2', book, await famDay(-20))).error);

  const earned = async () => (await stats('dad')).find(r => r.child_id === aria).earned;
  const e0 = await earned();
  ok('points count immediately when no check is needed', e0 >= 5);
  const chores = (await save('dad', 'Chores', { points: 10, check: true })).rows[0].t;
  await submit('ariaPhone2', chores, today);
  ok('checked task: no points before parent accepts', await earned() === e0);
  ok('child cannot accept own task', err(await as('ariaPhone2', `select review_result($1,$2,$3::date,true)`, [chores, aria, today])).includes('parents_only'));
  await as('dad', `select review_result($1,$2,$3::date,true)`, [chores, aria, today]);
  ok('points count after parent accepts', await earned() === e0 + 10);
  await as('dad', `select save_task($1,'Chores','16:00',127,true,array[$2]::uuid[],'repeat',null,50,true,false,'{}')`, [chores, aria]);
  ok('changing task points later keeps history', await earned() === e0 + 10);
  const dishes = (await save('dad', 'Dishes', { points: 7, check: true })).rows[0].t;
  await submit('ariaPhone2', dishes, today);
  await as('dad', `select review_result($1,$2,$3::date,false)`, [dishes, aria, today]);
  const rej = (await db.query(`select state, points from task_results where task_id=$1`, [dishes])).rows[0];
  ok('rejected done becomes not done with no points', rej.state === 'not_done' && rej.points === 0);
  const pianoDone = (await db.query(`select approved_at from task_results where task_id=$1 and local_date=$2`, [piano, today])).rows[0];
  ok('parent-recorded and old results are approved', pianoDone === undefined || pianoDone.approved_at !== undefined);

  // Rewards
  ok('child cannot create rewards', err(await as('ariaPhone2', `select save_reward(null,'X',1,true)`)).includes('parents_only'));
  const tablet = (await as('dad', `select save_reward(null,'Tablet time',$1,true) r`, [e0 + 10])).rows[0].r;
  const balance = async () => (await stats('ariaPhone2'))[0].balance;
  const before = await balance();
  const req = (await as('ariaPhone2', `select request_reward($1,$2) r`, [tablet, aria])).rows[0].r;
  ok('request reserves points', await balance() === before - (e0 + 10));
  ok('cannot overspend', err(await as('ariaPhone2', `select request_reward($1,$2)`, [tablet, aria])).includes('not_enough_points'));
  ok('sibling cannot request for aria', err(await as('samPhone', `select request_reward($1,$2)`, [tablet, aria])).includes('not_allowed'));
  ok('sibling cannot see aria requests', (await as('samPhone', `select count(*)::int n from reward_requests`)).rows[0].n === 0);
  await as('dad', `select decide_reward_request($1,false)`, [req]);
  ok('declined request returns points', await balance() === before);
  ok('decided request cannot be decided again', err(await as('dad', `select decide_reward_request($1,true)`, [req])).includes('request_not_found'));
  ok('child sees only own stats', (await stats('ariaPhone2')).length === 1);

  // Photo proof
  const room = (await save('dad', 'Clean room', { photo: true })).rows[0].t;
  ok('photo required for photo task', err(await submit('ariaPhone2', room, today)).includes('photo_required'));
  const myPath = `${fam}/${aria}/${room}/${today}-a.jpg`;
  ok('child uploads into own folder', !(await as('ariaPhone2', `insert into storage.objects(bucket_id,name) values ('proofs',$1)`, [myPath])).error);
  ok('child cannot upload into sibling folder', !!(await as('ariaPhone2', `insert into storage.objects(bucket_id,name) values ('proofs',$1)`, [`${fam}/${sam}/x/y.jpg`])).error);
  ok('parent cannot upload', !!(await as('dad', `insert into storage.objects(bucket_id,name) values ('proofs',$1)`, [`${fam}/${aria}/x/z.jpg`])).error);
  ok('fake photo path rejected', err(await submit('ariaPhone2', room, today, 'done', `${fam}/${aria}/${room}/nope.jpg`)).includes('photo_invalid'));
  ok('done with photo accepted', !(await submit('ariaPhone2', room, today, 'done', myPath)).error);
  ok('answering again keeps the earlier photo', !(await submit('ariaPhone2', room, today, 'done')).error
    && (await db.query(`select photo_path from task_results where task_id=$1`, [room])).rows[0].photo_path === myPath);
  ok('parent can see the photo', (await as('dad', `select count(*)::int n from storage.objects`)).rows[0].n === 1);
  ok('sibling cannot see the photo', (await as('samPhone', `select count(*)::int n from storage.objects`)).rows[0].n === 0);
  ok('other family cannot see the photo', (await as('other', `select count(*)::int n from storage.objects`)).rows[0].n === 0);
  await db.query(`update storage.objects set created_at = now() - interval '61 days'`);
  const old = (await as(null, `select * from expired_photos()`, [], 'service_role')).rows;
  ok('expired photos listed for cleanup', old.length === 1 && old[0].name === myPath);
  await as(null, `select forget_photos($1::text[])`, [[myPath]], 'service_role');
  ok('results forget removed photos', (await db.query(`select photo_path from task_results where task_id=$1`, [room])).rows[0].photo_path === null);

  // Streak
  const zoe = (await as('dad', `select add_child('Zoe') c`)).rows[0].c;
  const walk = (await as('dad', `select save_task(null,'Walk dog','09:00',127,true,array[$1]::uuid[]) t`, [zoe])).rows[0].t;
  await db.query(`update tasks set starts_on = $2::date - 5 where id = $1`, [walk, today]);
  for (const n of [0, -1, -2, -4]) {
    await db.query(`insert into task_results(task_id,child_id,family_id,local_date,state,approved_at) values ($1,$2,$3,$4::date,'done',now())`, [walk, zoe, fam, await famDay(n)]);
  }
  const zoeStreak = async () => (await stats('dad')).find(r => r.child_id === zoe).streak;
  ok('streak counts consecutive complete days', await zoeStreak() === 3);
  await db.query(`delete from task_results where task_id=$1 and local_date=$2::date`, [walk, today]);
  ok('unfinished today does not break the streak', await zoeStreak() === 2);

  // Notification buttons (real clock)
  const nowLocal = (await db.query(`select to_char((now() at time zone 'America/Toronto') - interval '2 minutes','HH24:MI') t`)).rows[0].t;
  const fish = (await as('dad', `select save_task(null,'Feed fish',$1::time,127,true,array[$2]::uuid[]) t`, [nowLocal, aria])).rows[0].t;
  const pack = (await save('dad', 'Pack bag', { list: ['books', ' ', 'lunch'] })).rows[0].t;
  ok('blank checklist items dropped', (await db.query(`select checklist from tasks where id=$1`, [pack])).rows[0].checklist.length === 2);
  const live = (await as(null, `select * from claim_due_reminders()`, [], 'service_role')).rows.find(r => r.title === 'Feed fish');
  ok('live reminder claimed with token', !!live?.token && live.quick_done === true);
  ok('users cannot use tokens directly', err(await as('ariaPhone2', `select use_reminder_token('x','done')`)).includes('permission denied'));
  const useTok = async (t, a) => (await as(null, `select use_reminder_token($1,$2) r`, [t, a], 'service_role')).rows[0].r;
  ok('wrong token is invalid', await useTok('NOPE', 'done') === 'invalid');
  ok('Done button records the result', await useTok(live.token, 'done') === 'done'
    && (await db.query(`select state from task_results where task_id=$1`, [fish])).rows[0]?.state === 'done');
  ok('token works only once', await useTok(live.token, 'done') === 'invalid');

  // Reminders: freeze a task at a known date and simulate the clock
  await db.query(`update tasks set starts_on = '2027-01-01'`);
  await db.query(`delete from task_results`);
  const claim = async (ts) => (await as(null, `select * from claim_due_reminders($1::timestamptz)`, [ts], 'service_role')).rows;
  // Piano 17:00 Toronto on Tue 2027-01-05 = 22:00Z
  ok('nothing before due', (await claim('2027-01-05T21:59:00Z')).length === 0);
  const r1 = await claim('2027-01-05T22:00:30Z');
  ok('due reminder claimed with endpoint', r1.length === 1 && r1[0].title === 'Piano' && r1[0].endpoint === 'https://push.example/abc');
  ok('second run does not resend', (await claim('2027-01-05T22:01:30Z')).length === 0);
  const r2 = await claim('2027-01-05T22:05:30Z');
  ok('rings again after 5 minutes', r2.length === 1 && r2[0].attempt === 2);
  ok('third ring after 10 minutes', (await claim('2027-01-05T22:10:30Z'))[0]?.attempt === 3);
  ok('stops after 3 rings', (await claim('2027-01-05T22:15:30Z')).length === 0);
  ok('each ring has a fresh token', r1[0].token && r2[0].token && r1[0].token !== r2[0].token);
  ok('outage beyond lookback is skipped', (await claim('2027-01-06T22:30:00Z')).length === 0);
  // Already answered -> no reminder (Wed 2027-01-06 17:00 local)
  await db.query(`insert into task_results values ($1,$2,$3,'2027-01-07','done','',null,now())`, [piano, aria, fam]);
  ok('answered task not reminded', (await claim('2027-01-07T22:00:30Z')).length === 0);
  // DST spring-forward: Toronto 2027-03-14 02:00 -> 03:00. Task at 02:30 fires once at 03:30 EDT (07:30Z).
  await db.query(`update tasks set time_local='02:30' where id=$1`, [piano]);
  ok('nonexistent local time not fired early', (await claim('2027-03-14T07:00:00Z')).length === 0);
  ok('nonexistent local time fires once', (await claim('2027-03-14T07:31:00Z')).length === 1);
  // DST fall-back: 2027-11-07 01:30 occurs twice; must fire exactly once across the window.
  await db.query(`update tasks set time_local='01:30' where id=$1`, [piano]);
  let fb = 0;
  for (let m = 0; m <= 180; m++) fb += (await claim(new Date(Date.parse('2027-11-07T05:00:00Z') + m * 60000).toISOString())).length;
  ok('repeated local time rings one series of 3', fb === 3);
  // Archived child gets no reminders
  await db.query(`update tasks set time_local='17:00' where id=$1`, [piano]);
  await as('dad', `select update_child($1,'Aria',true)`, [aria]);
  ok('archived child not reminded', (await claim('2027-01-12T22:00:30Z')).length === 0);
  ok('archiving unlinks devices', (await db.query(`select count(*)::int n from child_devices where child_id=$1`, [aria])).rows[0].n === 0);

  // Limits
  for (let i = 0; i < 9; i++) await as('other', `select add_child('k${i}')`);
  ok('child limit enforced', err(await as('other', `select add_child('k10')`)).includes('limit_children'));

  // Cleanup removes abandoned anonymous users only
  await db.query(`update auth.users set created_at = now() - interval '2 days'`);
  await db.query(`select private.cleanup()`);
  const left = (await db.query(`select count(*)::int n from auth.users where id = any($1)`, [[users.stranger.id, users.samPhone.id]])).rows[0].n;
  ok('cleanup removes unlinked anon only', left === 1);

  // Delete family cascades, other family untouched
  await as('dad', `select delete_family()`);
  ok('family deleted with data', (await db.query(`select count(*)::int n from tasks where family_id=$1`, [fam])).rows[0].n === 0);
  ok('other family intact', (await db.query(`select count(*)::int n from families`)).rows[0].n === 1);

  // Last parent deleting their account removes their family
  await as('other', `select delete_my_account()`);
  ok('last parent leaving deletes family', (await db.query(`select count(*)::int n from families`)).rows[0].n === 0);

  console.log(`${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED:\n- ' + failures.join('\n- ')); process.exitCode = 1; }
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
