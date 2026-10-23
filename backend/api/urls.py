# urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

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
    path('', include(router.urls)),

    path('periods/<int:period_id>/teacher_availability/',
         views.TeacherAvailabilityPeriodAPI.as_view(), name='teacher-availability'),

    path('timetables/<int:timetable_id>/generate/',
         views.GenerateTimetableEntriesAPIView.as_view(), name='generate-timetable'),

    path('schools/<int:school_id>/solver-settings/', views.SolverSettingsView.as_view(), name='solver-settings'),

    path('timetables/<int:timetable_id>/json/',
         views.TimetableJSONView.as_view(), name='timetable-json'),
]