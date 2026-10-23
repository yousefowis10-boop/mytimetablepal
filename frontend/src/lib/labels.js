// Human labels for codes coming from the API. Literal t("...") calls keep every string in the translation files.

export const roleLabel = (t, r) => ({
  admin: t("School admin"), staff: t("Staff"), teacher: t("Teacher"), parent: t("Parent"), driver: t("Bus driver"),
}[r] || r);

export const roleOptions = (t) => ["admin", "staff", "teacher", "parent", "driver"].map((r) => ({ value: r, label: roleLabel(t, r) }));

export const roomTypeLabel = (t, v) => ({
  regular: t("Regular classroom"), lab: t("Science lab"), computer_lab: t("Computer lab"), gym: t("Gym / sports"),
  other: t("Other"), "": t("Any classroom"),
}[v ?? ""] || v);

export const roomTypeOptions = (t, withAny = false) => [
  ...(withAny ? [{ value: "", label: roomTypeLabel(t, "") }] : []),
  ...["regular", "lab", "computer_lab", "gym", "other"].map((v) => ({ value: v, label: roomTypeLabel(t, v) })),
].filter((o) => !(withAny && o.value === "regular"));

export const attendanceLabel = (t, s) => ({
  present: t("Present"), absent: t("Absent"), late: t("Late"), excused: t("Excused"),
}[s] || s);

export const stageLabel = (t, s) => ({
  inquiry: t("Inquiry"), placement_test: t("Placement test"), documents: t("Documents"), accepted: t("Accepted"),
  enrolled: t("Enrolled"), rejected: t("Not proceeding"),
}[s] || s);

export const STAGES = ["inquiry", "placement_test", "documents", "accepted", "enrolled", "rejected"];

export const feeCategoryLabel = (t, c) => ({
  tuition: t("Tuition"), trip: t("Trip"), books: t("Books"), uniform: t("Uniform"), bus: t("Bus"), other: t("Other"),
}[c] || c);

export const paymentMethodLabel = (t, m) => ({
  cash: t("Cash"), transfer: t("Bank transfer"), cheque: t("Cheque"), other: t("Other"),
}[m] || m);

export const pickupModeLabel = (t, m) => ({
  parent: t("Parent picks up"), other: t("Someone else picks up"), bus: t("On the bus"), walk: t("Walks home"),
}[m] || m);

export const audienceLabel = (t, a) => ({
  school: t("Whole school"), staff: t("All staff"), parents: t("All parents"), grade: t("A grade"),
  group: t("A class group"), guardian: t("One parent"),
}[a] || a);

export const eventKindLabel = (t, k) => ({
  holiday: t("Holiday"), exam: t("Exam"), event: t("Event"), no_school: t("No school"), term: t("Term date"),
}[k] || k);

export const periodTypeLabel = (t, k) => ({
  lecture: t("Lesson"), break: t("Break"), lab: t("Lab"), other: t("Other"),
}[k] || k);

export const schoolStatusLabel = (t, s) => ({ trial: t("Trial"), active: t("Active"), suspended: t("Suspended") }[s] || s);

export const jobStatusLabel = (t, s) => ({
  queued: t("Queued"), running: t("Running"), succeeded: t("Done"), failed: t("Failed"),
  infeasible: t("No valid timetable"),
}[s] || s);

export const busStatusLabel = (t, s) => ({
  planned: t("Not started"), active: t("On the way"), completed: t("Finished"),
  picked_up: t("Picked up"), dropped_off: t("Dropped off"), absent: t("Absent"),
}[s] || s);

export const moduleLabel = (t, m) => ({
  timetable: t("Timetable generator"), communication: t("Announcements, calendar & messages"), attendance: t("Attendance"),
  substitutes: t("Teacher absence & substitutes"), homework: t("Homework"), grades: t("Grades & report cards"),
  exams: t("Exam scheduling"), fees: t("Fees & installments"), admissions: t("Admissions"),
  pickup: t("Pickup & dismissal"), transport: t("School bus routes & tracking"),
}[m] || m);

export const violationLabel = (t, k) => ({
  spread: t("Same subject twice in a day"), spread_unavoidable: t("...of which unavoidable"),
  teacher_gaps: t("Free periods between a teacher's lessons"), heavy_late: t("Heavy subjects after the morning"),
  room_change: t("Lessons outside the home room"), teacher_split: t("Subjects split between teachers"),
  load_balance: t("Uneven teacher load"),
}[k] || k);

export const weightLabel = (t, k) => ({
  spread: t("Spread each subject across the week"), teacher_gaps: t("Avoid gaps in teachers' days"),
  heavy_late: t("Heavy subjects in the morning"), room_change: t("Keep groups in their home room"),
  teacher_split: t("One teacher per subject per group"), load_balance: t("Balance teachers' load"),
}[k] || k);
