"use strict";

// Accaza HR roles. Pure: no database access. Spec: docs/ACCAZA_HR_SPEC.md section 0A.
// One rule: owners (HR Manager, Assistant HR) act directly, staff view and request,
// and every change is written to the audit log. There is no second-person approval.

const ROLES = Object.freeze(["employee", "hr_manager", "assistant_hr"]);
const OWNER_ROLES = new Set(["hr_manager", "assistant_hr"]);
const OWNER_ONLY = "Only the HR Manager or Assistant HR can do this.";

// Members enrolled before roles carry only canManage. They keep that workspace access.
function memberRole(member) {
  if (ROLES.includes(member?.role)) return member.role;
  return null;
}

function canManageWorkspace(member) {
  const role = memberRole(member);
  if (role) return role !== "employee";
  return member?.canManage === true;
}

function isOwner(member) {
  return member?.active === true && OWNER_ROLES.has(memberRole(member));
}

module.exports = {ROLES, memberRole, canManageWorkspace, isOwner, OWNER_ONLY};
