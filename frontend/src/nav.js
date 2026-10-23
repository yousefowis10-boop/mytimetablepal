import {
  AlarmClock, BarChart3, Bell, BookOpen, Bus, Calendar, CalendarCheck, CalendarClock, ClipboardCheck, ClipboardList,
  DoorOpen, FileSpreadsheet, GraduationCap, HelpCircle, Home, Inbox, LayoutDashboard, ListChecks, MapPin,
  MessageSquare, Megaphone, NotebookPen, Receipt, School, Settings, ShieldCheck, Sparkles, UserPlus, Users,
  UserSquare, Wallet, AlertTriangle, Building2, Navigation,
} from "lucide-react";

const M = ["admin", "staff"];
const STAFF = ["admin", "staff", "teacher"];

// label is an English key translated at render time; module = plan module needed (if any).
export const NAV = [
  { section: "Overview", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: [...STAFF, "parent"], end: true },
    { to: "/setup", label: "Setup checklist", icon: ListChecks, roles: M },
    { to: "/today", label: "My lessons today", icon: AlarmClock, roles: ["teacher"] },
    { to: "/my-timetable", label: "My timetable", icon: CalendarClock, roles: ["teacher"] },
    { to: "/children", label: "My children", icon: Home, roles: ["parent"] },
    { to: "/driver", label: "My route", icon: Navigation, roles: ["driver"], module: "transport" },
  ] },
  { section: "Communication", items: [
    { to: "/inbox", label: "Inbox", icon: Inbox, roles: ["parent", ...STAFF], module: "communication" },
    { to: "/announcements", label: "Announcements", icon: Megaphone, roles: STAFF, module: "communication" },
    { to: "/messages", label: "Messages", icon: MessageSquare, roles: [...M, "parent"], module: "communication" },
    { to: "/calendar", label: "Calendar", icon: Calendar, roles: [...STAFF, "parent", "driver"], module: "communication" },
    { to: "/faq", label: "FAQ", icon: HelpCircle, roles: [...STAFF, "parent"], module: "communication" },
  ] },
  { section: "Daily", items: [
    { to: "/attendance", label: "Attendance", icon: ClipboardCheck, roles: STAFF, module: "attendance" },
    { to: "/substitutes", label: "Absences & covers", icon: UserSquare, roles: STAFF, module: "substitutes" },
    { to: "/dismissal", label: "Dismissal", icon: DoorOpen, roles: STAFF, module: "pickup" },
    { to: "/pickup", label: "Pickup today", icon: DoorOpen, roles: ["parent"], module: "pickup" },
    { to: "/bus", label: "School bus", icon: Bus, roles: ["parent"], module: "transport" },
  ] },
  { section: "Learning", items: [
    { to: "/homework", label: "Homework", icon: NotebookPen, roles: [...STAFF, "parent"], module: "homework" },
    { to: "/grades", label: "Grades", icon: GraduationCap, roles: STAFF, module: "grades" },
    { to: "/at-risk", label: "At-risk students", icon: AlertTriangle, roles: STAFF, module: "grades" },
    { to: "/exams", label: "Exams", icon: ClipboardList, roles: STAFF, module: "exams" },
  ] },
  { section: "School", items: [
    { to: "/students", label: "Students", icon: Users, roles: STAFF },
    { to: "/guardians", label: "Parents", icon: Users, roles: M },
    { to: "/people", label: "Invitations", icon: UserPlus, roles: M },
    { to: "/teachers", label: "Teachers", icon: GraduationCap, roles: M },
    { to: "/subjects", label: "Subjects", icon: BookOpen, roles: M },
    { to: "/classrooms", label: "Rooms", icon: Building2, roles: M },
    { to: "/groups", label: "Class groups", icon: School, roles: M },
    { to: "/schedules", label: "Bell schedule", icon: CalendarCheck, roles: M },
    { to: "/timetables", label: "Timetables", icon: Sparkles, roles: STAFF },
  ] },
  { section: "Office", items: [
    { to: "/fees", label: "Fees", icon: Wallet, roles: M, module: "fees" },
    { to: "/my-fees", label: "Fees", icon: Receipt, roles: ["parent"], module: "fees" },
    { to: "/admissions", label: "Admissions", icon: UserPlus, roles: M, module: "admissions" },
    { to: "/transport", label: "Buses & routes", icon: MapPin, roles: M, module: "transport" },
    { to: "/reports", label: "Reports & exports", icon: FileSpreadsheet, roles: STAFF },
    { to: "/import", label: "Import from Excel", icon: FileSpreadsheet, roles: M },
    { to: "/audit", label: "Audit log", icon: ShieldCheck, roles: ["admin"] },
    { to: "/settings", label: "School settings", icon: Settings, roles: ["admin"] },
  ] },
];

export const ALWAYS = [
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/profile", label: "My profile", icon: Users },
];

export const OWNER = { to: "/owner", label: "Owner panel", icon: BarChart3 };

export function visibleNav(auth) {
  return NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => (!i.roles || auth.hasRole(...i.roles)) && auth.hasModule(i.module)),
  })).filter((s) => s.items.length);
}

// The first four destinations on the phone bottom bar, per role.
export function mobileTabs(auth) {
  const flat = visibleNav(auth).flatMap((s) => s.items);
  const pick = (paths) => paths.map((p) => flat.find((i) => i.to === p)).filter(Boolean);
  if (auth.hasRole("admin", "staff")) return pick(["/", "/attendance", "/students", "/inbox"]);
  if (auth.hasRole("teacher")) return pick(["/", "/today", "/homework", "/inbox"]);
  if (auth.hasRole("parent")) return pick(["/children", "/bus", "/inbox", "/my-fees"]);
  if (auth.hasRole("driver")) return pick(["/driver", "/calendar"]);
  return flat.slice(0, 4);
}
