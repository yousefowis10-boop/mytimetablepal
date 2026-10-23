from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import account_views, platform, views

router = DefaultRouter()

router.register(r'schools', views.SchoolViewSet, basename='school')
router.register(r'schools/(?P<school_id>\d+)/groups', views.StudentGroupViewSet, basename='studentgroup')
router.register(r'schools/(?P<school_id>\d+)/teachers', views.TeacherViewSet, basename='teacher')
router.register(r'schools/(?P<school_id>\d+)/classrooms', views.ClassroomViewSet, basename='classroom')
router.register(r'schools/(?P<school_id>\d+)/subjects', views.SubjectViewSet, basename='subject')
router.register(r'schools/(?P<school_id>\d+)/schedules', views.ScheduleViewSet, basename='schedule')
router.register(r'schools/(?P<school_id>\d+)/timetables', views.TimetableViewSet, basename='timetable')
router.register(r'groups/(?P<student_group_id>\d+)/requirements', views.SubjectRequirementViewSet,
                basename='subjectrequirement')

urlpatterns = [
    path('health/', views.HealthView.as_view(), name='health'),
    path('register/', views.RegisterView.as_view(), name='register'),

    # Platform: sign-up, me, invitations, plans, owner panel
    path('signup/school/', platform.SchoolSignupView.as_view(), name='signup-school'),
    path('me/', platform.MeView.as_view(), name='me'),
    path('plans/', platform.PlansView.as_view(), name='plans'),
    path('invitations/accept/', platform.InvitationAcceptView.as_view(), name='invitation-accept'),
    path('invitations/<str:code>/', platform.InvitationPreviewView.as_view(), name='invitation-preview'),
    path('schools/<int:school_id>/invitations/', platform.InvitationListView.as_view()),
    path('schools/<int:school_id>/invitations/<int:pk>/', platform.InvitationDetailView.as_view()),
    path('schools/<int:school_id>/setup/', platform.SetupChecklistView.as_view()),
    path('platform/schools/', platform.OwnerSchoolsView.as_view()),
    path('platform/schools/<int:pk>/<str:action>/', platform.OwnerSchoolActionView.as_view()),
    path('platform/plans/<int:pk>/', platform.OwnerPlanView.as_view()),

    # Notifications & audit
    path('notifications/', account_views.NotificationsView.as_view()),
    path('push/', account_views.PushConfigView.as_view()),
    path('push/subscribe/', account_views.PushSubscribeView.as_view()),
    path('schools/<int:school_id>/audit/', account_views.AuditLogView.as_view()),

    path('', include(router.urls)),

    path('periods/<int:period_id>/teacher_availability/',
         views.TeacherAvailabilityPeriodAPI.as_view(), name='teacher-availability'),
    path('timetables/<int:timetable_id>/generate/',
         views.GenerateTimetableEntriesAPIView.as_view(), name='generate-timetable'),
    path('schools/<int:school_id>/solver-settings/', views.SolverSettingsView.as_view(), name='solver-settings'),
    path('timetables/<int:timetable_id>/json/',
         views.TimetableJSONView.as_view(), name='timetable-json'),
]
