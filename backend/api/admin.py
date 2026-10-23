from django.contrib import admin
from .models import School, Teacher, Classroom, Schedule, SchedulePeriod, Subject, Availability, Timetable, TimetableEntry


@admin.register(TimetableEntry)
class TimetableEntryAdmin(admin.ModelAdmin):
    # Columns to display in list view
    list_display = (
        'id',
        'timetable',
        'student_group',
        'day_of_week',
        'period',
        'teacher',
        'covering_teacher',
        'subject',
        'classroom',
    )

    # Filters in the right sidebar
    list_filter = (
        'timetable',
        'student_group',
        'day_of_week',
        'period',
        'teacher',
        'covering_teacher',
        'classroom',
        'subject',
    )

    # Fields searchable in the search box
    search_fields = (
        'student_group__name',
        'teacher__name',
        'covering_teacher__name',
        'subject__name',
        'classroom__name',
    )

    # Optional: order by timetable, day, period
    ordering = ('timetable', 'day_of_week', 'period')

    # Optional: show raw ID fields for foreign keys to simplify form
    raw_id_fields = ('timetable', 'student_group', 'period', 'teacher', 'covering_teacher', 'subject', 'classroom')


@admin.register(School)
class SchoolAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'principal_name', 'established_year')


@admin.register(Teacher)
class TeacherAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'get_subjects', 'experience', 'school')
    search_fields = ('name',)
    list_filter = ('school', 'subjects')  # ✅ many-to-many works here

    def get_subjects(self, obj):
        return ", ".join([s.name for s in obj.subjects.all()])
    get_subjects.short_description = 'Subjects'  # ✅ column header name



@admin.register(Classroom)
class ClassroomAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'capacity', 'school')
    search_fields = ('name',)
    list_filter = ('school',)


@admin.register(Schedule)
class ScheduleAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "school", "is_active")
    list_filter = ("school", "is_active")


@admin.register(SchedulePeriod)
class SchedulePeriodAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "schedule", "start_time", "end_time", "type", "order")
    list_filter = ("schedule", "type")
    ordering = ("schedule", "order")


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "code", "description", "school")
    search_fields = ('name', 'code')
    list_filter = ('school',)


# ✅ Register Availability
@admin.register(Availability)
class AvailabilityAdmin(admin.ModelAdmin):
    list_display = ("id", "teacher", "slot", "start_time", "end_time")
    list_filter = ("teacher",)
    search_fields = ("teacher__name", "slot")

@admin.register(Timetable)
class TimetableAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'schedule', 'effective_date_start', 'effective_date_end', 'school')
    search_fields = ('name',)
    list_filter = ('school', 'schedule')