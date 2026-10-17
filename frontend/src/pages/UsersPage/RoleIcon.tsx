import { useTranslation } from "react-i18next";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import type { AdminUser } from "../../api/admin";

export type UserRoleKind = "owner" | "admin" | "member";

export function roleKind(user: Pick<AdminUser, "role" | "is_owner">): UserRoleKind {
  if (user.is_owner) return "owner";
  return user.role === "ADMIN" ? "admin" : "member";
}

const COLORS: Record<UserRoleKind, string> = {
  owner: "#a855f7",
  admin: "#3b82f6",
  member: "#22c55e",
};

const LABEL_KEYS = {
  owner: "adminSettings.users.owner",
  admin: "adminSettings.users.roleAdmin",
  member: "adminSettings.users.roleMember",
} as const;

export function useRoleLabel() {
  const { t } = useTranslation("app");
  return (kind: UserRoleKind) => t(LABEL_KEYS[kind]);
}

/** A person silhouette in the role's colour: the owner wears a crown, admins sunglasses, members smile. */
export default function RoleIcon({ kind, ...props }: { kind: UserRoleKind } & SvgIconProps) {
  const color = COLORS[kind];
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path d="M4 23c0-4.6 3.6-7.4 8-7.4s8 2.8 8 7.4z" fill={color} />
      <circle cx="12" cy="10" r="4.6" fill={color} />
      {kind === "owner" && (
        <>
          <path
            d="M8.1 6 7.5 1.9l2.5 1.9L12 1.2l2 2.6 2.5-1.9-.6 4.1z"
            fill="#fbbf24"
            stroke="#b45309"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        </>
      )}
      {kind === "admin" && (
        <>
          <path
            d="M8 8.6h3.4v1.7a1.5 1.5 0 0 1-1.5 1.5h-.4A1.5 1.5 0 0 1 8 10.3zm4.6 0H16v1.7a1.5 1.5 0 0 1-1.5 1.5h-.4a1.5 1.5 0 0 1-1.5-1.5z"
            fill="#111827"
          />
          <path d="M11.4 9h1.2" stroke="#111827" strokeWidth="0.7" />
          <path d="M8.7 9.3h.9m3.7 0h.9" stroke="#ffffff" strokeWidth="0.45" strokeLinecap="round" opacity="0.7" />
        </>
      )}
      {kind === "admin" ? (
        <path d="M10.7 12.7q1.6.6 2.9-.4" fill="none" stroke="#ffffff" strokeWidth="0.9" strokeLinecap="round" />
      ) : (
        <>
          <circle cx="10.4" cy="9.4" r="0.6" fill="#ffffff" />
          <circle cx="13.6" cy="9.4" r="0.6" fill="#ffffff" />
          <path d="M10.2 11.9q1.8 1.6 3.6 0" fill="none" stroke="#ffffff" strokeWidth="0.9" strokeLinecap="round" />
        </>
      )}
    </SvgIcon>
  );
}
