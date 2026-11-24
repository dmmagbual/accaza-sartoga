"use strict";

// Accaza HR roles and approval rules. Pure: no database access.
// Spec: docs/ACCAZA_HR_SPEC.md sections 0A and 5.

const ROLES = Object.freeze(["employee", "hr_manager", "assistant_hr"]);
const APPROVER_ROLES = new Set(["hr_manager", "assistant_hr"]);

// Members enrolled before roles existed carry only canManage. They keep that
// workspace access but are never approvers until a role is assigned.
function memberRole(member) {
  if (ROLES.includes(member?.role)) return member.role;
  return null;
}

function canManageWorkspace(member) {
  const role = memberRole(member);
  if (role) return role !== "employee";
  return member?.canManage === true;
}

function isApprover(member) {
  return member?.active === true && APPROVER_ROLES.has(memberRole(member));
}

/**
 * Returns null when the approver may act, or a reason code when not.
 * subjectId: employee the request is about. initiatorId: member who raised it.
 * With exactly two approvers this gives mutual approval, and when both are
 * away nobody else can approve, so the request waits.
 */
function approvalBlock(approver, {subjectId = null, initiatorId = null} = {}) {
  if (!isApprover(approver)) return "not_approver";
  if (subjectId !== null && approver.id === subjectId) return "own_record";
  if (initiatorId !== null && approver.id === initiatorId) return "own_proposal";
  return null;
}

const APPROVAL_MESSAGES = Object.freeze({
  not_approver: "Only the HR Manager or Assistant HR can approve this.",
  own_record: "You cannot approve or correct your own record. Ask the other HR approver.",
  own_proposal: "You cannot approve your own proposal. Ask the other HR approver.",
});

module.exports = {ROLES, memberRole, canManageWorkspace, isApprover, approvalBlock, APPROVAL_MESSAGES};
