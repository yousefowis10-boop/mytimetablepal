from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
S = r"schools/(?P<school_id>\d+)/transport"
router.register(rf"{S}/buses", views.BusViewSet, basename="bus")
router.register(rf"{S}/leave-overrides", views.LeaveOverrideViewSet, basename="leave-override")
router.register(rf"{S}/manual-routes", views.ManualRouteViewSet, basename="manual-route")

school = "schools/<int:school_id>/"
urlpatterns = [
    path("", include(router.urls)),
    path(school + "transport/settings/", views.TransportSettingsView.as_view()),
    path(school + "transport/plans/", views.PlansView.as_view()),
    path(school + "transport/live/", views.LiveOverviewView.as_view()),
    path(school + "driver/today/", views.DriverTodayView.as_view()),
    path(school + "driver/runs/<int:run_id>/<str:action>/", views.DriverRunActionView.as_view()),
    path(school + "my/bus/", views.MyBusView.as_view()),
]
