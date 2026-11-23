import {expect, test} from '@playwright/test';

async function installHrFirebase(page, response) {
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
    expect(name).toBe('manageHrWorkspace');
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
      expect(payload).toMatchObject({email: 'lead@example.test', name: 'Team Lead', active: true, canManage: true});
      expect(payload).not.toHaveProperty('id');
      employees.push({id: 'employee-2', name: payload.name, active: true, canManage: true, revision: 1});
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
  await editor.getByLabel('Can manage announcements, tasks, and schedules').check();
  await editor.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByText('Team Lead', {exact: true})).toBeVisible();
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
