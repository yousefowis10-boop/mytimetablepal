import { API_BASE_URL as API_BASE, TOKEN_KEY } from '../config/api';

const handleRequest = async (url, options = {}) => {
    const token = localStorage.getItem(TOKEN_KEY);

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(`${API_BASE}${url}`, {
            ...options,
            headers,
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Token expired or invalid
                localStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem('refresh_token');
                window.location.href = '/login';
                throw new Error('Authentication failed. Please login again.');
            }

            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        if (response.status === 204) {
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`API Error (${url}):`, error);
        throw error;
    }
};

export const login = async (email, password) => {
    return handleRequest('/token/', {
        method: 'POST',
        body: JSON.stringify({ username: email, password }),
    });
};

export const register = async (userData) => {
    return handleRequest('/register/', {
        method: 'POST',
        body: JSON.stringify(userData),
    });
};

// School API
export const fetchSchools = async () => {
    return handleRequest('/schools/');
};

export const fetchSchool = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/`);
};

export const createSchool = async (schoolData) => {
    return handleRequest('/schools/', {
        method: 'POST',
        body: JSON.stringify(schoolData),
    });
};

export const updateSchool = async (schoolId, schoolData) => {
    return handleRequest(`/schools/${schoolId}/`, {
        method: 'PUT',
        body: JSON.stringify(schoolData),
    });
};

export const deleteSchool = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/`, {
        method: 'DELETE',
    });
};

// Teacher API
export const fetchTeachers = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/teachers/`);
};

export const fetchTeacher = async (schoolId, teacherId) => {
    return handleRequest(`/schools/${schoolId}/teachers/${teacherId}/`);
};

export const createTeacher = async (schoolId, teacherData) => {
    return handleRequest(`/schools/${schoolId}/teachers/`, {
        method: 'POST',
        body: JSON.stringify(teacherData),
    });
};

export const updateTeacher = async (schoolId, teacherId, teacherData) => {
    return handleRequest(`/schools/${schoolId}/teachers/${teacherId}/`, {
        method: 'PUT',
        body: JSON.stringify(teacherData),
    });
};

export const deleteTeacher = async (schoolId, teacherId) => {
    return handleRequest(`/schools/${schoolId}/teachers/${teacherId}/`, {
        method: 'DELETE',
    });
};

// Availability API
export const fetchTeacherAvailability = async (schoolId, teacherId) => {
    return handleRequest(`/schools/${schoolId}/teachers/${teacherId}/availability/`);
};

export const createAvailability = async (schoolId, teacherId, availabilityData) => {
    return handleRequest(`/schools/${schoolId}/teachers/${teacherId}/availability/`, {
        method: 'POST',
        body: JSON.stringify(availabilityData),
    });
};

export const updateAvailability = async (schoolId, teacherId, availabilityId, availabilityData) => {
    return handleRequest(`/schools/${schoolId}/teachers/${teacherId}/availability/${availabilityId}/`, {
        method: 'PATCH',
        body: JSON.stringify(availabilityData),
    });
};


export const deleteAvailability = async (schoolId, teacherId, availabilityId) => {
    return handleRequest(`/schools/${schoolId}/teachers/${teacherId}/availability/${availabilityId}/`, {
        method: 'DELETE',
    });
};

// Classroom API
export const fetchClassrooms = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/classrooms/`);
};

export const fetchClassroom = async (schoolId, classroomId) => {
    return handleRequest(`/schools/${schoolId}/classrooms/${classroomId}/`);
};

export const createClassroom = async (schoolId, classroomData) => {
    return handleRequest(`/schools/${schoolId}/classrooms/`, {
        method: 'POST',
        body: JSON.stringify(classroomData),
    });
};

export const updateClassroom = async (schoolId, classroomId, classroomData) => {
    return handleRequest(`/schools/${schoolId}/classrooms/${classroomId}/`, {
        method: 'PUT',
        body: JSON.stringify(classroomData),
    });
};

export const deleteClassroom = async (schoolId, classroomId) => {
    return handleRequest(`/schools/${schoolId}/classrooms/${classroomId}/`, {
        method: 'DELETE',
    });
};

// Schedule API
export const fetchSchedules = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/schedules/`);
};

export const fetchSchedule = async (schoolId, scheduleId) => {
    return handleRequest(`/schools/${schoolId}/schedules/${scheduleId}/`);
};

export const createSchedule = async (schoolId, scheduleData) => {
    return handleRequest(`/schools/${schoolId}/schedules/`, {
        method: 'POST',
        body: JSON.stringify(scheduleData),
    });
};

export const updateSchedule = async (schoolId, scheduleId, scheduleData) => {
    return handleRequest(`/schools/${schoolId}/schedules/${scheduleId}/`, {
        method: 'PUT',
        body: JSON.stringify(scheduleData),
    });
};

export const deleteSchedule = async (schoolId, scheduleId) => {
    return handleRequest(`/schools/${schoolId}/schedules/${scheduleId}/`, {
        method: 'DELETE',
    });
};

// Schedule Period API
export const fetchSchedulePeriods = async (schoolId, scheduleId) => {
    return handleRequest(`/schools/${schoolId}/schedules/${scheduleId}/periods/`);
};

export const createSchedulePeriod = async (schoolId, scheduleId, periodData) => {
    return handleRequest(`/schools/${schoolId}/schedules/${scheduleId}/periods/`, {
        method: 'POST',
        body: JSON.stringify(periodData),
    });
};

export const updateSchedulePeriod = async (schoolId, scheduleId, periodId, periodData) => {
    return handleRequest(`/schools/${schoolId}/schedules/${scheduleId}/periods/${periodId}/`, {
        method: 'PUT',
        body: JSON.stringify(periodData),
    });
};

export const deleteSchedulePeriod = async (schoolId, scheduleId, periodId) => {
    return handleRequest(`/schools/${schoolId}/schedules/${scheduleId}/periods/${periodId}/`, {
        method: 'DELETE',
    });
};

// Subject API
export const fetchSubjects = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/subjects/`);
};

export const fetchSubject = async (schoolId, subjectId) => {
    return handleRequest(`/schools/${schoolId}/subjects/${subjectId}/`);
};

export const createSubject = async (schoolId, subjectData) => {
    return handleRequest(`/schools/${schoolId}/subjects/`, {
        method: 'POST',
        body: JSON.stringify(subjectData),
    });
};

export const updateSubject = async (schoolId, subjectId, subjectData) => {
    return handleRequest(`/schools/${schoolId}/subjects/${subjectId}/`, {
        method: 'PUT',
        body: JSON.stringify(subjectData),
    });
};

export const deleteSubject = async (schoolId, subjectId) => {
    return handleRequest(`/schools/${schoolId}/subjects/${subjectId}/`, {
        method: 'DELETE',
    });
};

// Student Group API
export const fetchStudentGroups = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/groups/`);
};

export const fetchStudentGroup = async (schoolId, groupId) => {
    return handleRequest(`/schools/${schoolId}/groups/${groupId}/`);
};

export const createStudentGroup = async (schoolId, groupData) => {
    return handleRequest(`/schools/${schoolId}/groups/`, {
        method: 'POST',
        body: JSON.stringify(groupData),
    });
};

export const updateStudentGroup = async (schoolId, groupId, groupData) => {
    return handleRequest(`/schools/${schoolId}/groups/${groupId}/`, {
        method: 'PUT',
        body: JSON.stringify(groupData),
    });
};

export const deleteStudentGroup = async (schoolId, groupId) => {
    return handleRequest(`/schools/${schoolId}/groups/${groupId}/`, {
        method: 'DELETE',
    });
};

// Subject Requirement API

export const fetchGroupRequirements = async (schoolId, groupId) => {
    return handleRequest(`/schools/${schoolId}/groups/${groupId}/requirements/`);
};

export const fetchSubjectRequirements = async (groupId) => {
    return handleRequest(`/groups/${groupId}/requirements/`);
};

export const createSubjectRequirement = async (groupId, requirementData) => {
    return handleRequest(`/groups/${groupId}/requirements/`, {
        method: 'POST',
        body: JSON.stringify(requirementData),
    });
};

export const updateSubjectRequirement = async (groupId, requirementId, requirementData) => {
    return handleRequest(`/groups/${groupId}/requirements/${requirementId}/`, {
        method: 'PUT',
        body: JSON.stringify(requirementData),
    });
};

export const deleteSubjectRequirement = async (groupId, requirementId) => {
    return handleRequest(`/groups/${groupId}/requirements/${requirementId}/`, {
        method: 'DELETE',
    });
};

// Timetable API
export const fetchTimetables = async (schoolId) => {
    return handleRequest(`/schools/${schoolId}/timetables/`);
};

export const fetchTimetable = async (schoolId, timetableId) => {
    return handleRequest(`/schools/${schoolId}/timetables/${timetableId}/`);
};

export const createTimetable = async (schoolId, timetableData) => {
    return handleRequest(`/schools/${schoolId}/timetables/`, {
        method: 'POST',
        body: JSON.stringify(timetableData),
    });
};

export const updateTimetable = async (schoolId, timetableId, timetableData) => {
    return handleRequest(`/schools/${schoolId}/timetables/${timetableId}/`, {
        method: 'PUT',
        body: JSON.stringify(timetableData),
    });
};

export const deleteTimetable = async (schoolId, timetableId) => {
    return handleRequest(`/schools/${schoolId}/timetables/${timetableId}/`, {
        method: 'DELETE',
    });
};

// Timetable Entry API
export const fetchTimetableEntries = async (schoolId, timetableId) => {
    return handleRequest(`/schools/${schoolId}/timetables/${timetableId}/entries/`);
};

export const bulkUpdateTimetableEntries = async (schoolId, timetableId, entries) => {
    return handleRequest(`/schools/${schoolId}/timetables/${timetableId}/bulk_update_entries/`, {
        method: 'POST',
        body: JSON.stringify({ entries }),
    });
};

export const generateTimetableEntries = async (schoolId, timetableId) => {
    return handleRequest(`/schools/${schoolId}/timetables/${timetableId}/generate/`, {
        method: 'POST',
    });
};

export const fetchTimetableJSON = async (schoolId, timetableId, viewType = 'grade') => {
    return handleRequest(`/schools/${schoolId}/timetables/${timetableId}/json_view/?type=${viewType}`);
};

// Teacher Availability Period API
export const fetchTeacherAvailabilityPeriod = async (periodId) => {
    return handleRequest(`/periods/${periodId}/teacher_availability/`);
};

export const updateTeacherAvailabilityPeriod = async (periodId, teacherIds) => {
    return handleRequest(`/periods/${periodId}/teacher_availability/`, {
        method: 'POST',
        body: JSON.stringify({ teachers: teacherIds }),
    });
};

// Export all functions
export default {
    // Auth
    login,
    register,

    // School
    fetchSchools,
    fetchSchool,
    createSchool,
    updateSchool,
    deleteSchool,

    // Teacher
    fetchTeachers,
    fetchTeacher,
    createTeacher,
    updateTeacher,
    deleteTeacher,

    // Availability
    fetchTeacherAvailability,
    createAvailability,
    updateAvailability,
    deleteAvailability,

    // Classroom
    fetchClassrooms,
    fetchClassroom,
    createClassroom,
    updateClassroom,
    deleteClassroom,

    // Schedule
    fetchSchedules,
    fetchSchedule,
    createSchedule,
    updateSchedule,
    deleteSchedule,

    // Schedule Period
    fetchSchedulePeriods,
    createSchedulePeriod,
    updateSchedulePeriod,
    deleteSchedulePeriod,

    // Subject
    fetchSubjects,
    fetchSubject,
    createSubject,
    updateSubject,
    deleteSubject,

    // Student Group
    fetchStudentGroups,
    fetchStudentGroup,
    createStudentGroup,
    updateStudentGroup,
    deleteStudentGroup,

    // Subject Requirement
    fetchSubjectRequirements,
    createSubjectRequirement,
    updateSubjectRequirement,
    deleteSubjectRequirement,

    // Timetable
    fetchTimetables,
    fetchTimetable,
    createTimetable,
    updateTimetable,
    deleteTimetable,

    // Timetable Entry
    fetchTimetableEntries,
    bulkUpdateTimetableEntries,
    generateTimetableEntries,
    fetchTimetableJSON,

    // Teacher Availability Period
    fetchTeacherAvailabilityPeriod,
    updateTeacherAvailabilityPeriod,
};