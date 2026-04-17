import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatNotificationEmailTemplates,
  isNotificationEventKind,
  notificationRuleMatchesDraft,
} from './notificationEmailRules.js'
import type { NotificationDraft } from './workOrderNotifications.js'

test('isNotificationEventKind', () => {
  assert.equal(isNotificationEventKind('work_order_field_changed'), true)
  assert.equal(isNotificationEventKind('bogus'), false)
})

test('notificationRuleMatchesDraft empty condition matches kind', () => {
  const draft: NotificationDraft = {
    kind: 'work_order_field_changed',
    message: 'x',
    payloadJson: { field: 'status', before: 'open', after: 'done' },
  }
  assert.equal(
    notificationRuleMatchesDraft(
      { event_kind: 'work_order_field_changed', condition_json: {} },
      draft,
    ),
    true,
  )
})

test('notificationRuleMatchesDraft field and after', () => {
  const draft: NotificationDraft = {
    kind: 'work_order_field_changed',
    message: 'x',
    payloadJson: { field: 'status', before: 'open', after: 'done' },
  }
  assert.equal(
    notificationRuleMatchesDraft(
      {
        event_kind: 'work_order_field_changed',
        condition_json: { field: 'status', after: 'done' },
      },
      draft,
    ),
    true,
  )
  assert.equal(
    notificationRuleMatchesDraft(
      {
        event_kind: 'work_order_field_changed',
        condition_json: { field: 'status', after: 'open' },
      },
      draft,
    ),
    false,
  )
})

test('notificationRuleMatchesDraft wrong kind', () => {
  const draft: NotificationDraft = {
    kind: 'work_instruction_created',
    message: 'x',
    payloadJson: {},
  }
  assert.equal(
    notificationRuleMatchesDraft(
      { event_kind: 'work_order_field_changed', condition_json: {} },
      draft,
    ),
    false,
  )
})

test('formatNotificationEmailTemplates defaults when templates empty', () => {
  const draft: NotificationDraft = {
    kind: 'work_order_field_changed',
    message: 'Status set',
    payloadJson: { field: 'status', after: 'done' },
  }
  const r = formatNotificationEmailTemplates({
    subjectTemplate: null,
    bodyTemplate: '   ',
    ruleName: 'R1',
    draft,
    workOrderId: 'wo-uuid',
    woKey: 42,
  })
  assert.equal(r.subject, '[WO 42] Status set')
  assert.ok(r.text.includes('wo-uuid'))
  assert.ok(r.text.includes('work_order_field_changed'))
})

test('formatNotificationEmailTemplates placeholders', () => {
  const draft: NotificationDraft = {
    kind: 'work_order_field_changed',
    message: 'Hello',
    payloadJson: { a: 1 },
  }
  const r = formatNotificationEmailTemplates({
    subjectTemplate: 'Rule {rule_name} WO{wo_key}',
    bodyTemplate: '{message}\n---\n{payload_json}',
    ruleName: 'Done alert',
    draft,
    workOrderId: 'id-1',
    woKey: 7,
  })
  assert.equal(r.subject, 'Rule Done alert WO7')
  assert.ok(r.text.startsWith('Hello'))
  assert.ok(r.text.includes('"a": 1'))
})
