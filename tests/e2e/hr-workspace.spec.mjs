import {expect, test} from '@playwright/test';

async function installHrFirebase(page, response, callable = 'manageHrWorkspace') {
  const modules = {
    'firebase-app.js': 'export function initializeApp(config,name){globalThis.hrTestAppName=name;return {config,name};}',
    'firebase-app-check.js': 'export class ReCaptchaEnterpriseProvider{} export function initializeAppCheck(){return {};} export async function getToken(){return {token:"test"};}',
    'firebase-auth.js': [
      'export const browserSessionPersistence={},inMemoryPersistence={};',
      'const auth={currentUser:null};let notify;',
      'export function initializeAuth(){return auth;}',
      'export function onAuthStateChanged(_auth,callback){notify=callback;queueMicrotask(()=>notify(auth.currentUser));}',
      'export async function signInWithEmailAndPassword(_auth,email){auth.currentUser={uid:email,isAnonymous:false};notify(auth.currentUser);}',
      'export async function signOut(){auth.currentUser=null;notify(null);}',
    ].join('\n'),
    'firebase-functions.js': [
      'export function getFunctions(){return {};}',
      'export function httpsCallable(_f,name){return async (body)=>{',
      'const value=await globalThis.hrTestRequest(name,body);',
      'if(value.error) throw Object.assign(new Error(value.error.message),value.error);',
      'return {data:value};};}',
    ].join('\n'),
  };
  await page.route('https://www.gstatic.com/firebasejs/10.12.0/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!modules[name]) return route.abort();
    await route.fulfill({
      contentType: 'text/javascript', headers: {'access-control-allow-origin': '*'}, body: modules[name],
    });
  });
  await page.exposeFunction('hrTestRequest', (name, payload) => {
    expect(name).toBe(callable);
    return response(payload);
  });
}

async function signIn(page) {
  await page.goto('/hr.html');
  await page.getByLabel('Email').fill('staff@example.test');
  await page.getByLabel('Password').fill('synthetic-test-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
}

test('HR is a separate signed-in workspace with task, team, and sign-out flows', async ({page}) => {
  const member = {id: 'employee-1', name: 'Alex', canManage: false, chart: 'bar'};
  const announcement = {id: 'note', title: 'Team briefing', body: 'Meet at opening.', status: 'published'};
  const task = {id: 'example-task', title: 'Open the shop', assigneeId: member.id, dueDate: '2026-11-26', steps: [], status: 'pending', progress: 0, revision: 1};
  const shift = {id: 'overnight', employeeId: member.id, startAt: Date.parse('2026-11-23T22:00:00+08:00'), endAt: Date.parse('2026-11-24T06:00:00+08:00'), note: '', status: 'published'};
  const calls = [];
  await installHrFirebase(page, (payload) => {
    calls.push(payload);
    if (payload.action === 'home') return {member, canEnroll: false, announcements: [announcement], tasks: [task], shifts: [shift]};
    if (payload.action === 'list') {
      return {rows: {members: [member], tasks: [task], shifts: [shift]}[payload.resource], nextCursor: null};
    }
    if (payload.action === 'addStep') {
      task.steps.push({id: payload.stepId, title: payload.title, done: false});
      task.revision++;
      return {id: payload.id};
    }
    if (payload.action === 'setStep') {
      expect(payload.revision).toBe(task.revision);
      task.steps[0].done = payload.done;
      task.progress = 100;
      task.status = 'completed';
      task.revision++;
      return {id: payload.id};
    }
    if (payload.action === 'setChart') {
      member.chart = payload.chart;
      return {ok: true};
    }
    throw new Error('Unexpected HR action ' + payload.action);
  });
  await signIn(page);
  await expect(page.getByRole('heading', {name: 'My workspace'})).toBeVisible();
  expect(await page.evaluate(() => globalThis.hrTestAppName)).toBe('accaza-hr');
  await expect(page.getByText('Meet at opening.')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'My schedule'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Management'})).toBeHidden();
  expect(calls.map(({action}) => action)).toEqual(['home']);

  const viewport = page.viewportSize();
  for (const width of [1440, 1024, 820, 768, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    const nav = await page.getByRole('navigation', {name: 'HR workspace'}).boundingBox();
    const dashboard = await page.getByRole('heading', {name: 'My workspace'}).boundingBox();
    if (width > 864) expect(nav.x + nav.width).toBeLessThan(dashboard.x);
    else expect(nav.y + nav.height).toBeLessThan(dashboard.y);
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(hasOverflow, 'horizontal overflow at ' + width + 'px').toBe(false);
  }
  await page.setViewportSize(viewport);

  await page.getByRole('button', {name: 'Add step'}).click();
  await page.getByRole('dialog').getByLabel('Step', {exact: true}).fill('Count cups');
  await page.getByRole('dialog').getByRole('button', {name: 'Save'}).click();
  await page.getByRole('checkbox', {name: 'Count cups'}).click();
  await expect(page.getByText('Completed', {exact: true})).toBeVisible();
  await page.getByLabel('Progress view').selectOption('donut');
  await expect(page.getByLabel('Progress view')).toHaveValue('donut');

  await page.getByRole('button', {name: 'Team', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Team task board'})).toBeVisible();
  await expect(page.getByText('Open the shop', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page.getByRole('heading', {name: 'Staff sign-in'})).toBeVisible();
  await expect(page.getByText('Open the shop', {exact: true})).toHaveCount(0);
});

test('an unenrolled Super Admin can enroll the first HR manager', async ({page}) => {
  const employees = [];
  await installHrFirebase(page, (payload) => {
    if (payload.action === 'home') return {member: null, canEnroll: true, announcements: [], tasks: [], shifts: []};
    if (payload.action === 'list') return {rows: employees, nextCursor: null};
    if (payload.action === 'saveMember') {
      expect(payload).toMatchObject({email: 'lead@example.test', name: 'Team Lead', active: true, role: 'hr_manager'});
      expect(payload).not.toHaveProperty('canManage');
      expect(payload).not.toHaveProperty('id');
      employees.push({id: 'employee-2', name: payload.name, active: true, role: 'hr_manager', canManage: true, revision: 1});
      return {id: 'employee-2'};
    }
    throw new Error('Unexpected HR action ' + payload.action);
  });
  await signIn(page);
  await expect(page.getByRole('heading', {name: 'Management', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Enroll employee'}).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Accaza account email').fill('lead@example.test');
  await editor.getByLabel('Display name').fill('Team Lead');
  await editor.getByLabel('HR role').selectOption('hr_manager');
  await editor.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByText('Team Lead', {exact: true})).toBeVisible();
  await expect(page.getByText('HR Manager', {exact: true})).toBeVisible();
});

test('a manager can assign work to an employee on a later roster page', async ({page}) => {
  const manager = {id: 'manager-1', name: 'Manager', canManage: true, chart: 'bar'};
  const tasks = [{
    id: 'existing', title: 'Check stock', assigneeId: 'staff-last', assigneeName: 'Taylor',
    dueDate: '2026-11-26', steps: [], status: 'pending', progress: 0, revision: 1,
  }];
  await installHrFirebase(page, (payload) => {
    if (payload.action === 'home') return {member: manager, canEnroll: false, announcements: [], tasks: [], shifts: []};
    if (payload.action === 'list') {
      if (payload.resource === 'members') {
        return payload.cursor ? {rows: [{id: 'staff-last', name: 'Taylor', active: true}], nextCursor: null}
          : {rows: [{id: 'staff-old', name: 'Past employee', active: false}], nextCursor: 'more'};
      }
      return {rows: payload.resource === 'tasks' ? tasks : [], nextCursor: null};
    }
    if (payload.action === 'saveTask') {
      expect(payload.assigneeId).toBe('staff-last');
      tasks.push({...payload, assigneeName: 'Taylor', steps: [], revision: 1, status: 'pending', progress: 0});
      return {id: payload.id};
    }
    throw new Error('Unexpected HR action ' + payload.action);
  });
  await signIn(page);
  await page.getByRole('button', {name: 'Management'}).click();
  await page.getByRole('combobox', {name: 'Manage', exact: true}).selectOption('tasks');
  await expect(page.getByText(/Taylor.*Due/)).toBeVisible();
  await page.getByRole('button', {name: 'Assign task'}).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('button', {name: 'Load more employees'}).click();
  await editor.getByRole('combobox', {name: 'Assignee'}).selectOption('staff-last');
  await editor.getByLabel('Title').fill('Prep counter');
  await editor.getByLabel('Deadline (Manila date)').fill('2026-11-27');
  await editor.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByText('Prep counter', {exact: true})).toBeVisible();
});

test('HR approvers propose and review hours settings for the other owner', async ({page}) => {
  const owner = {id: 'owner-a', name: 'Owner A', role: 'hr_manager', canManage: true, chart: 'bar'};
  const values = {dailyRegularMin: 480, breakThresholdMin: 300, breakDeductMin: 30, restDay: 0, longShiftFlagMin: 960};
  const rows = [{
    id: 'from-b', status: 'proposed', effectiveFrom: '2026-12-05', reason: 'Seven-hour day.', proposedBy: 'owner-b',
    proposedByName: 'Owner B', revision: 1, values: {...values, dailyRegularMin: 420},
  }];
  const calls = [];
  await installHrFirebase(page, (payload) => {
    calls.push(payload);
    if (payload.action === 'home') return {member: owner, canEnroll: false, announcements: [], tasks: [], shifts: []};
    if (payload.action === 'list') return {rows: [], nextCursor: null};
    if (payload.action === 'listHoursSettings') {
      return {current: {versionId: 'default', effectiveFrom: null, values}, earliest: '2026-11-21', canApprove: true, rows, nextCursor: null};
    }
    if (payload.action === 'proposeHoursSettings') {
      rows.unshift({id: payload.requestId, status: 'proposed', effectiveFrom: payload.effectiveFrom, reason: payload.reason,
        proposedBy: 'owner-a', proposedByName: 'Owner A', revision: 1, values: payload.values});
      return {id: payload.requestId};
    }
    if (payload.action === 'decideHoursSettings') {
      Object.assign(rows.find((row) => row.id === payload.id), {status: 'approved', decidedByName: 'Owner A', revision: 2});
      return {id: payload.id, status: 'approved'};
    }
    throw new Error('Unexpected HR action ' + payload.action);
  });
  await signIn(page);
  await page.getByRole('button', {name: 'Management'}).click();
  await page.getByRole('combobox', {name: 'Manage', exact: true}).selectOption('settings');
  await expect(page.getByText('In force this pay week')).toBeVisible();
  await expect(page.getByText('Unpaid break: 30 min on shifts longer than 5 h').first()).toBeVisible();

  await page.getByRole('button', {name: 'Propose change'}).click();
  let editor = page.getByRole('dialog');
  await expect(editor.getByLabel('Takes effect from (a Saturday)')).toHaveValue('2026-11-28');
  await editor.getByLabel('Unpaid break (minutes)').fill('60');
  await editor.getByLabel('Regular hours per day before overtime').fill('7.5');
  await editor.getByLabel('Reason for the change').fill('One-hour meal break.');
  await editor.getByLabel('Takes effect from (a Saturday)').fill('2026-11-30');
  await editor.getByRole('button', {name: 'Send for approval'}).click();
  await expect(editor.getByText('Choose a Saturday, the first day of a pay week.')).toBeVisible();
  await editor.getByLabel('Takes effect from (a Saturday)').fill('2026-11-28');
  await editor.getByRole('button', {name: 'Send for approval'}).click();
  await expect(page.getByText('Waiting for the other approver.')).toBeVisible();
  const proposal = calls.find((call) => call.action === 'proposeHoursSettings');
  expect(proposal).toMatchObject({effectiveFrom: '2026-11-28', reason: 'One-hour meal break.',
    values: {breakDeductMin: 60, breakThresholdMin: 300, dailyRegularMin: 450, restDay: 0, longShiftFlagMin: 960}});
  expect(proposal.requestId).toMatch(/^[0-9a-f]{32}$/);

  await page.getByRole('button', {name: 'Review'}).click();
  editor = page.getByRole('dialog');
  await expect(editor.getByText('Regular hours per day: 7 h, then daily overtime')).toBeVisible();
  await editor.getByRole('button', {name: 'Confirm'}).click();
  await expect(page.getByText(/approved by Owner A/)).toBeVisible();
  expect(calls.find((call) => call.action === 'decideHoursSettings')).toEqual({action: 'decideHoursSettings', id: 'from-b', decision: 'approve', revision: 1});
});

test('managers see weekly hours, export them, and approvers keep the holiday table', async ({page}) => {
  await page.clock.install({time: new Date('2026-11-30T09:00:00+08:00')});
  const owner = {id: 'owner-a', name: 'Owner A', role: 'hr_manager', canManage: true, chart: 'bar'};
  const values = {dailyRegularMin: 480, breakThresholdMin: 300, breakDeductMin: 30, restDay: 0, longShiftFlagMin: 960};
  const holidays = [];
  const calls = [];
  await installHrFirebase(page, (payload) => {
    calls.push(payload);
    if (payload.action === 'home') return {member: owner, canEnroll: false, announcements: [], tasks: [], shifts: []};
    if (payload.action === 'list') return {rows: [], nextCursor: null};
    if (payload.action === 'weeklyHours') {
      return {
        weekStart: payload.weekStart, weekEnd: '2026-11-27', team: true, blocked: true, holidays: [],
        settings: {versionId: 'default', effectiveFrom: null, values},
        employees: [{employeeId: 'amy', name: 'Amy', regularMin: 930, dailyOtMin: 90, restDayMin: 330, regularHolidayMin: 0,
          specialHolidayMin: 0, paidMin: 1350, grossMin: 1440, breakMin: 90, days: []}],
        issues: [{code: 'holidays_not_loaded', year: 2026, blocking: true, recordId: null, employeeId: null, employeeName: null}],
      };
    }
    if (payload.action === 'listHolidays') return {year: payload.year, complete: false, yearRevision: 0, canEdit: true, rows: holidays};
    if (payload.action === 'saveHoliday') {
      holidays.push({id: payload.date, date: payload.date, name: payload.name, type: payload.type, active: true, revision: 1});
      return {id: payload.date, revision: 1};
    }
    throw new Error('Unexpected HR action ' + payload.action);
  });
  await signIn(page);
  await page.getByRole('button', {name: 'Management'}).click();
  await page.getByRole('combobox', {name: 'Manage', exact: true}).selectOption('hours');
  await expect(page.getByText('Paid 22 h 30 min (unpaid breaks 1 h 30 min)')).toBeVisible();
  await expect(page.getByText(/2026 holiday list is not marked complete/)).toBeVisible();
  expect(calls.find((call) => call.action === 'weeklyHours').weekStart).toBe('2026-11-21');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download CSV'}).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('accaza-hours-2026-11-21.csv');
  const csv = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  expect(csv).toContain('"2026-11-21","2026-11-27","Has issues to fix","Amy","amy","15.50","1.50","5.50","0.00","0.00","22.50","1350","1.50","default"');

  await page.getByRole('combobox', {name: 'Manage', exact: true}).selectOption('holidays');
  await page.getByRole('button', {name: 'Add holiday'}).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Date').fill('2026-12-25');
  await editor.getByLabel('Name').fill('Christmas Day');
  await editor.getByRole('combobox', {name: 'Type'}).selectOption('regular');
  await editor.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByText(/Christmas Day/)).toBeVisible();
  expect(calls.find((call) => call.action === 'saveHoliday')).toEqual({action: 'saveHoliday', date: '2026-12-25', name: 'Christmas Day', type: 'regular'});
});

test('the attendance tablet retries unconfirmed punches and blocks expired retries', async ({page}) => {
  const requests = [];
  await page.clock.install({time: new Date('2026-11-23T09:00:00+08:00')});
  await installHrFirebase(page, (payload) => {
    if (payload.action === 'pair') return {credential: 'synthetic-tablet-credential', expiresAt: Date.parse('2026-12-23T09:00:00+08:00')};
    if (payload.action === 'roster') return {rows: [{id: 'staff-1', name: 'Taylor'}], nextCursor: null};
    if (payload.action === 'punch') {
      requests.push(payload.requestId);
      if (requests.length !== 2) return {error: {code: 'functions/unavailable', message: 'Offline'}};
      return {id: 'shift-1', at: Date.parse('2026-11-23T09:00:00+08:00'), type: 'in'};
    }
    throw new Error('Unexpected tablet action ' + payload.action);
  }, 'recordHrAttendance');

  const selectPunch = async (direction) => {
    await page.getByLabel('Employee').selectOption('staff-1');
    await page.getByLabel('Clock action').selectOption(direction);
    await page.getByLabel('Your six-digit HR PIN').fill('012345');
  };
  await page.goto('/hr-attendance.html');
  await page.getByLabel('Pairing code').fill('synthetic-code');
  await page.getByRole('button', {name: 'Pair tablet'}).click();
  await selectPunch('in');
  await page.getByRole('button', {name: 'Record attendance'}).click();
  await expect(page.getByRole('alert')).toContainText(/unconfirmed|could not confirm/i);
  await expect(page.getByLabel('Your six-digit HR PIN')).toHaveValue('');
  await page.reload();
  await selectPunch('in');
  await page.getByRole('button', {name: 'Retry attendance'}).click();
  await expect(page.getByRole('status')).toContainText('Clock-in recorded');
  expect(requests[1]).toEqual(requests[0]);

  await selectPunch('out');
  await page.getByRole('button', {name: 'Record attendance'}).click();
  await expect(page.getByRole('alert')).toContainText(/unconfirmed|could not confirm/i);
  await page.clock.fastForward(6 * 60 * 1000);
  await page.reload();
  await page.getByLabel('Employee').selectOption('staff-1');
  await page.getByLabel('Clock action').selectOption('out');
  await expect(page.locator('#tablet-retry')).toContainText(/manager/i);
  await expect(page.locator('#tablet-submit')).toBeDisabled();
  expect(requests).toHaveLength(3);
});
