import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import { EmptyState, Loading } from "./components/ui";
import { Join, Login, SignupSchool } from "./pages/auth";
import { Dashboard, NewSchool, Notifications, OwnerPanel, Profile, Setup } from "./pages/home";
import {
  Classrooms, Groups, Guardians, Invitations, PeriodAvailability, Schedules, Students, Subjects, TeacherAvailability, Teachers,
} from "./pages/schooldata";
import { MyTimetable, SolverSettings, TimetableEditor, Timetables } from "./pages/timetables";
import { Announcements, CalendarPage, FAQPage, Inbox, Messages } from "./pages/comms";
import { AbsenceDetail, Attendance, Dismissal, Pickup, Substitutes, TakeAttendance, Today } from "./pages/daily";
import { AtRisk, Exams, Grades, Homework, ReportCard } from "./pages/learning";
import { Children, MyFees, ParentBus } from "./pages/parent";
import { Admissions, Fees, ReceiptPrint } from "./pages/office";
import { DriverApp, DriverSheet, Transport } from "./pages/transport";
import { AuditLog, ImportPage, Reports, SchoolSettings } from "./pages/admin";

const M = ["admin", "staff"];
const STAFF = ["admin", "staff", "teacher"];

function Guard({ roles, module, children }) {
  const { t } = useTranslation();
  const auth = useAuth();
  if (!auth.school) return <Navigate to="/" replace />;
  if (roles && !auth.hasRole(...roles)) return <EmptyState title={t("This page is not available for your role.")} />;
  if (module && !auth.hasModule(module)) return <EmptyState title={t("This feature is not part of your school's plan.")} />;
  return children;
}

function Protected({ children }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

function Param({ name, render }) {
  const params = useParams();
  return render(params[name]);
}

const g = (el, roles, module) => <Guard roles={roles} module={module}>{el}</Guard>;

function AppRoutes() {
  const { me, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <Loading /> : me ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={<SignupSchool />} />
      <Route path="/join" element={<Join />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="setup" element={g(<Setup />, M)} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
        <Route path="new-school" element={<NewSchool />} />
        <Route path="owner" element={<OwnerPanel />} />

        <Route path="today" element={g(<Today />, ["teacher"])} />
        <Route path="my-timetable" element={g(<MyTimetable />, ["teacher"])} />
        <Route path="children" element={g(<Children />, ["parent"])} />
        <Route path="children/:id/timetable" element={g(<Param name="id" render={(id) => <MyTimetable studentId={id} />} />, ["parent", ...STAFF])} />
        <Route path="driver" element={g(<DriverApp />, ["driver"], "transport")} />

        <Route path="inbox" element={g(<Inbox />, null, "communication")} />
        <Route path="announcements" element={g(<Announcements />, STAFF, "communication")} />
        <Route path="messages" element={g(<Messages />, [...M, "parent"], "communication")} />
        <Route path="calendar" element={g(<CalendarPage />, null, "communication")} />
        <Route path="faq" element={g(<FAQPage />, null, "communication")} />

        <Route path="attendance" element={g(<Attendance />, STAFF, "attendance")} />
        <Route path="attendance/take" element={g(<TakeAttendance />, STAFF, "attendance")} />
        <Route path="substitutes" element={g(<Substitutes />, STAFF, "substitutes")} />
        <Route path="substitutes/:id" element={g(<AbsenceDetail />, STAFF, "substitutes")} />
        <Route path="dismissal" element={g(<Dismissal />, STAFF, "pickup")} />
        <Route path="pickup" element={g(<Pickup />, ["parent"], "pickup")} />
        <Route path="bus" element={g(<ParentBus />, ["parent"], "transport")} />

        <Route path="homework" element={g(<Homework />, [...STAFF, "parent"], "homework")} />
        <Route path="grades" element={g(<Grades />, STAFF, "grades")} />
        <Route path="students/:id/report-card" element={g(<ReportCard />, [...STAFF, "parent"], "grades")} />
        <Route path="at-risk" element={g(<AtRisk />, STAFF, "grades")} />
        <Route path="exams" element={g(<Exams />, STAFF, "exams")} />

        <Route path="students" element={g(<Students />, STAFF)} />
        <Route path="guardians" element={g(<Guardians />, M)} />
        <Route path="people" element={g(<Invitations />, M)} />
        <Route path="teachers" element={g(<Teachers />, M)} />
        <Route path="teachers/:id/availability" element={g(<Param name="id" render={(id) => <TeacherAvailability teacherId={id} />} />, M)} />
        <Route path="periods/:id/availability" element={g(<Param name="id" render={(id) => <PeriodAvailability periodId={id} />} />, M)} />
        <Route path="subjects" element={g(<Subjects />, M)} />
        <Route path="classrooms" element={g(<Classrooms />, M)} />
        <Route path="groups" element={g(<Groups />, M)} />
        <Route path="schedules" element={g(<Schedules />, M)} />
        <Route path="timetables" element={g(<Timetables />, STAFF)} />
        <Route path="timetables/settings" element={g(<SolverSettings />, M, "timetable")} />
        <Route path="timetables/:id" element={g(<TimetableEditor />, STAFF)} />

        <Route path="fees" element={g(<Fees />, M, "fees")} />
        <Route path="fees/receipt/:id" element={g(<ReceiptPrint />, M, "fees")} />
        <Route path="my-fees" element={g(<MyFees />, ["parent"], "fees")} />
        <Route path="admissions" element={g(<Admissions />, M, "admissions")} />
        <Route path="transport" element={g(<Transport />, M, "transport")} />
        <Route path="transport/sheet/:planId/:routeId" element={g(<DriverSheet />, M, "transport")} />
        <Route path="reports" element={g(<Reports />, STAFF)} />
        <Route path="import" element={g(<ImportPage />, M)} />
        <Route path="audit" element={g(<AuditLog />, ["admin"])} />
        <Route path="settings" element={g(<SchoolSettings />, ["admin"])} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-center" toastOptions={{ duration: 3500 }} />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
