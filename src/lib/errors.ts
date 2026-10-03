// The database raises stable snake_case codes; this is the only place they become words.
const MESSAGES: Record<string, string> = {
  parents_only: 'Only parents can do this.',
  email_account_required: 'Parents need to sign in with email and password first.',
  recovery_invalid: 'That email and recovery code don’t match. Check both and try again.',
  weak_password: 'Use at least 8 characters for your password.',
  confirm_email_enabled: 'Sign-up is misconfigured: turn off “Confirm email” in Supabase Auth settings.',
  server_error: 'The server had a problem. Try again in a minute.',
  sign_in_required: 'Sign in first.',
  already_in_family: 'This account already belongs to a family.',
  invalid_timezone: 'Choose a time zone from the list.',
  invite_invalid: 'This code is wrong, expired or already used. Ask a parent for a new one.',
  invalid_invite_kind: 'This kind of code is not supported.',
  name_required: 'Enter your name.',
  limit_children: 'A family can have up to 10 children.',
  limit_parents: 'A family can have up to 4 parents.',
  limit_tasks: 'A family can have up to 200 tasks.',
  limit_invites: 'There are too many unused codes. Wait for some to expire or be used.',
  limit_push: 'Notifications are already on for 10 devices on this account.',
  child_not_found: 'That child is no longer in this family.',
  task_not_found: 'That task no longer exists.',
  device_not_found: 'That device is already unlinked.',
  assignee_required: 'Choose at least one child for this task.',
  not_allowed: 'You can only report your own tasks.',
  not_assigned: 'This task is not assigned to this child.',
  date_in_future: 'You can’t report a day that hasn’t happened yet.',
  not_scheduled: 'This task isn’t scheduled on that day.',
  too_old: 'That day is too long ago to change.',
  invalid_state: 'Choose Done, Need help or Not done.',
  photo_required: 'Take a photo first, then tap Done.',
  photo_invalid: 'The photo didn’t upload properly. Take it again.',
  due_date_required: 'Choose a date for this one-time task.',
  checklist_too_long: 'A checklist can have up to 20 items.',
  invalid_task_kind: 'Choose Repeats or One time.',
  result_not_found: 'This answer changed meanwhile. Pull down to refresh.',
  limit_rewards: 'A family can have up to 50 rewards.',
  limit_pending_rewards: 'You already have 10 requests waiting. Wait for a parent to answer them.',
  not_enough_points: 'Not enough points yet. Keep going!',
  reward_not_found: 'That reward is no longer available.',
  request_not_found: 'That request was already answered.',
};

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k));
  if (code) return MESSAGES[code];
  if (/Invalid login credentials/i.test(raw)) return 'Wrong email or password.';
  if (/already registered|already exists/i.test(raw)) return 'An account with this email already exists. Sign in instead.';
  if (/password should be|weak password/i.test(raw)) return 'Use at least 8 characters for your password.';
  if (/valid email|invalid email|unable to validate email/i.test(raw)) return 'Enter a valid email address.';
  if (/rate limit|too many requests/i.test(raw)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/fetch|network|Failed to load/i.test(raw)) return 'No connection. Check your internet and try again.';
  if (/captcha/i.test(raw)) return 'The security check failed. Try again.';
  return raw || 'Something went wrong. Try again.';
}
