from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import academics, admissions, attendance, comms, dashboard, data_io, exams, fees, people, pickup, staffing

router = DefaultRouter()
S = r"schools/(?P<school_id>\d+)"
router.register(rf"{S}/students", people.StudentViewSet, basename="student")
router.register(rf"{S}/guardians", people.GuardianViewSet, basename="guardian")
router.register(rf"{S}/announcements", comms.AnnouncementViewSet, basename="announcement")
router.register(rf"{S}/calendar", comms.CalendarEventViewSet, basename="calendar")
router.register(rf"{S}/faqs", comms.FAQViewSet, basename="faq")
router.register(rf"{S}/threads", comms.ThreadViewSet, basename="thread")
router.register(rf"{S}/absence-reports", attendance.AbsenceReportViewSet, basename="absence-report")
router.register(rf"{S}/teacher-absences", staffing.TeacherAbsenceViewSet, basename="teacher-absence")
router.register(rf"{S}/homework", academics.HomeworkViewSet, basename="homework")
router.register(rf"{S}/terms", academics.TermViewSet, basename="term")
router.register(rf"{S}/assessments", academics.AssessmentViewSet, basename="assessment")
router.register(rf"{S}/exam-periods", exams.ExamPeriodViewSet, basename="exam-period")
router.register(rf"{S}/exams", exams.ExamViewSet, basename="exam")
router.register(rf"{S}/fee-plans", fees.FeePlanViewSet, basename="fee-plan")
router.register(rf"{S}/student-fees", fees.StudentFeeViewSet, basename="student-fee")
router.register(rf"{S}/payments", fees.PaymentViewSet, basename="payment")
router.register(rf"{S}/applicants", admissions.ApplicantViewSet, basename="applicant")

school = "schools/<int:school_id>/"
urlpatterns = [
    path("", include(router.urls)),
    path(school + "inbox/", comms.InboxView.as_view()),
    path(school + "inbox/<int:pk>/read/", comms.InboxView.as_view()),
    path(school + "teacher/today/", attendance.TeacherTodayView.as_view()),
    path(school + "attendance/sheet/", attendance.AttendanceSheetView.as_view()),
    path(school + "attendance/report/", attendance.AttendanceReportView.as_view()),
    path(school + "covers/", staffing.CoverLoadView.as_view()),
    path(school + "students/<int:student_id>/report-card/", academics.ReportCardView.as_view()),
    path(school + "students/<int:student_id>/fees/", fees.StudentStatementView.as_view()),
    path(school + "at-risk/", academics.AtRiskView.as_view()),
    path(school + "fees/balances/", fees.FeeBalancesView.as_view()),
    path(school + "my/children/", dashboard.MyChildrenView.as_view()),
    path(school + "my/children/<int:student_id>/timetable/", dashboard.MyChildTimetableView.as_view()),
    path(school + "my/timetable/", dashboard.MyTimetableView.as_view()),
    path(school + "my/pickup/", pickup.MyPickupView.as_view()),
    path(school + "dismissal/", pickup.DismissalView.as_view()),
    path(school + "dashboard/", dashboard.DashboardView.as_view()),
    path(school + "import/<str:kind>/", data_io.ImportView.as_view()),
    path(school + "export/<str:kind>/", data_io.ExportView.as_view()),
]
