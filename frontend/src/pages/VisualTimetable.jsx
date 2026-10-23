import {useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {useSchool} from "../context/SchoolContext";
import {AlertCircle, Calendar, CheckCircle, Copy, Plus, Save, Trash2, Users, XCircle} from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import useTimetablePdf from "../hooks/useTimetablePdf"; // Import the PDF hook
import {
    bulkUpdateTimetableEntries,
    fetchClassrooms,
    fetchGroupRequirements,
    fetchSchedules,
    fetchStudentGroups,
    fetchSubjects,
    fetchTeacherAvailability,
    fetchTeachers,
    fetchTimetableEntries,
    generateTimetableEntries,
} from "../services/api";
import toast from 'react-hot-toast';

const DAYS = [
    { id: 7, name: "Sunday" },
    { id: 1, name: "Monday" },
    { id: 2, name: "Tuesday" },
    { id: 3, name: "Wednesday" },
    { id: 4, name: "Thursday" }
];

export default function VisualTimetable() {
    const { id: timetableId } = useParams();
    const navigate = useNavigate();
    const { school } = useSchool();
    const { downloadPdf } = useTimetablePdf(timetableId); // Initialize PDF export

    const [studentGroups, setStudentGroups] = useState([]);
    const [classrooms, setClassrooms] = useState([]);
    const [teachers, setTeachers] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [periods, setPeriods] = useState([]);
    const [entries, setEntries] = useState([]);

    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [showCover, setShowCover] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [copiedEntry, setCopiedEntry] = useState(null);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);
    const [coverModalEntry, setCoverModalEntry] = useState(null);

    const [showUnmet, setShowUnmet] = useState(false);
    const [showOvermet, setShowOvermet] = useState(false);

    const [exporting, setExporting] = useState(false);

    const [teacherAvailability, setTeacherAvailability] = useState({});
    const [selectedSchedule, setSelectedSchedule] = useState(null);
    const [allSchedules, setAllSchedules] = useState([]);
    const [groupRequirements, setGroupRequirements] = useState({});

    useEffect(() => {
        if (!school || !timetableId) {
            setLoading(false);
            return;
        }

        const loadAllData = async () => {
            try {
                setLoading(true);

                const [
                    schedulesData,
                    groupsData,
                    classroomsData,
                    teachersData,
                    subjectsData,
                    entriesData
                ] = await Promise.all([
                    fetchSchedules(school.id),
                    fetchStudentGroups(school.id),
                    fetchClassrooms(school.id),
                    fetchTeachers(school.id),
                    fetchSubjects(school.id),
                    fetchTimetableEntries(school.id, timetableId)
                ]);

                setAllSchedules(schedulesData || []);

                const schedule = schedulesData[0];
                setSelectedSchedule(schedule);
                setPeriods(schedule?.periods || []);

                setStudentGroups(groupsData || []);
                setClassrooms(classroomsData || []);
                setTeachers(teachersData || []);
                setSubjects(subjectsData || []);
                setEntries(entriesData || []);

                // Load group requirements for the bar
                await loadGroupRequirements(groupsData || []);
                await loadTeacherAvailability(teachersData || []);

            } catch (err) {
                console.error("Error loading timetable data:", err);
                toast.error("Failed to load timetable data. Please try again.");
            } finally {
                setLoading(false);
            }
        };
        loadAllData();
    }, [school, timetableId]);

    // NEW FUNCTION: Load group requirements
    const loadGroupRequirements = async (groups) => {
        try {
            const reqMap = {};
            for (const group of groups) {
                try {
                    const requirements = await fetchGroupRequirements(school.id ,group.id);
                    reqMap[group.id] = requirements || [];
                } catch (err) {
                    console.error(`Error loading requirements for group ${group.id}:`, err);
                    reqMap[group.id] = [];
                }
            }
            setGroupRequirements(reqMap);
        } catch (err) {
            console.error("Error loading group requirements:", err);
        }
    };


    // useEffect(() => {
    //     if (error || success) {
    //         const timer = setTimeout(() => {
    //             toast.error("");
    //             toast.success("");
    //         }, 5000);
    //         return () => clearTimeout(timer);
    //     }
    // }, [error, success]);

    const getSubjectName = (subjectId) => {
        const subject = subjects.find(s => s.id === subjectId);
        return subject ? subject.name : "—";
    };

    const getGroupName = (groupId) => {
        const group = studentGroups.find(g => g.id === groupId);
        return group ? group.name : "—";
    };

    const getTeacherName = (teacherId) => {
        const teacher = teachers.find(t => t.id === teacherId);
        return teacher ? teacher.name : "—";
    };

    const getClassroomName = (classroomId) => {
        const classroom = classrooms.find(c => c.id === classroomId);
        return classroom ? classroom.name : "—";
    };

    const getPeriodTime = (periodId) => {
        const period = periods.find(p => p.id === periodId);
        return period ? `${period.start_time} - ${period.end_time}` : "";
    };

    const getEntry = (dayId, periodId, groupId) => {
        return entries.find(entry => {
            const entryDay = Number(entry.day_of_week);
            const entryPeriod = Number(entry.period);
            const entryGroup = Number(entry.student_group);
            const searchDay = Number(dayId);
            const searchPeriod = Number(periodId);
            const searchGroup = Number(groupId);

            // if (match) {
            //     console.log("Found entry:", entry);
            // }

            return entryDay === searchDay &&
                entryPeriod === searchPeriod &&
                entryGroup === searchGroup;
        });
    };


    const getUnmetRequirements = () => {
        const unmet = [];
        for (const group of studentGroups) {
            const gid = group.id;
            const reqs = groupRequirements[gid] || [];
            for (const req of reqs) {
                const subjectId = req.subject;
                const required = req.lectures_per_week;
                const count = entries.filter(
                    e => e.student_group === gid && e.subject === subjectId
                ).length;

                if (count < required) {
                    unmet.push({
                        groupId: gid,
                        subjectId,
                        required,
                        current: count,
                        subjectName: req.subject_name || getSubjectName(subjectId)
                    });
                }
            }
        }
        return unmet;
    };

    const getOvermetRequirements = () => {
        const overmet = [];
        for (const group of studentGroups) {
            const gid = group.id;
            const reqs = groupRequirements[gid] || [];
            for (const req of reqs) {
                const subjectId = req.subject;
                const required = req.lectures_per_week;
                const count = entries.filter(
                    e => e.student_group === gid && e.subject === subjectId
                ).length;

                if (count > required) {
                    overmet.push({
                        groupId: gid,
                        subjectId,
                        required,
                        current: count,
                        subjectName: req.subject_name || getSubjectName(subjectId)
                    });
                }
            }
        }
        return overmet;
    };

    const unmetRequirements = getUnmetRequirements();
    const overmetRequirements = getOvermetRequirements();

    const handleGenerate = async () => {
        if (!confirm("Generate timetable entries? This will create entries based on subject requirements and availability.")) return;

        setActionLoading(true);

        try {
            const result = await generateTimetableEntries(school.id, timetableId);

            const newEntries = await fetchTimetableEntries(school.id, timetableId);
            setEntries(newEntries || []);
            setHasUnsavedChanges(false); // Generated entries are saved to DB

            toast.success(result.message || "Timetable entries generated successfully!");
        } catch (err) {
            console.error("Generation error:", err);
            toast.error(err.message || "Failed to generate timetable entries. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleSave = async () => {
        if (!hasUnsavedChanges) {
            toast.error("No changes to save");
            return;
        }

        setActionLoading(true);

        try {
            const payload = entries.map(entry => {
                return {
                    day_of_week: Number(entry.day_of_week),
                    period: Number(entry.period),
                    classroom: Number(entry.classroom),
                    subject: Number(entry.subject),
                    teacher: Number(entry.teacher),
                    covering_teacher: entry.covering_teacher ? Number(entry.covering_teacher) : null,
                    student_group: Number(entry.student_group)
                };
            });


            await bulkUpdateTimetableEntries(school.id, timetableId, payload);

            setHasUnsavedChanges(false);
            toast.success("Timetable saved successfully!");

            // Reload entries to get proper IDs from backend
            const updatedEntries = await fetchTimetableEntries(school.id, timetableId);
            setEntries(updatedEntries || []);

        } catch (err) {
            console.error("Save error:", err);
            toast.error(err.message || "Failed to save timetable. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleExport = async (type) => {
        if (!type) return;

        setExporting(true);

        try {
            await downloadPdf(type);
        } catch (err) {
            console.error("PDF Export failed:", err);
            toast.error("Could not generate PDF. Please try again.");
        } finally {
            setExporting(false);
        }
    };
    const loadTeacherAvailability = async (teachersList) => {
        try {
            const availabilityPromises = teachersList.map(teacher =>
                fetchTeacherAvailability(school.id, teacher.id).catch(() => ({}))
            );

            const availabilities = await Promise.all(availabilityPromises);
            const availabilityMap = {};

            teachersList.forEach((teacher, index) => {
                availabilityMap[teacher.id] = availabilities[index];
            });

            setTeacherAvailability(availabilityMap);
        } catch (err) {
            console.error("Error loading teacher availability:", err);
        }
    };

    const isTeacherAvailable = (teacherId, dayId, periodId) => {
        const availability = teacherAvailability[teacherId];
        if (!availability || !availability.unavailable_periods) return true;

        return !availability.unavailable_periods.some(period =>
            period.day_of_week === dayId && period.period === periodId
        );
    };

    const handleAddEntry = (day, period, group) => {
        const existingEntry = getEntry(day.id, period.id, group.id);

        if (showCover) {
            if (existingEntry) {
                setCoverModalEntry({
                    day,
                    period: period.id,
                    studentGroup: group.id,
                    entry: existingEntry,
                    selectedTeacher: existingEntry.covering_teacher || ""
                });
            } else {
                setEditingEntry({
                    day: day.id,
                    period: period.id,
                    studentGroup: group.id,
                    subject: "",
                    teacher: "",
                    classroom: "",
                    covering_teacher: "",
                    isNew: true
                });
                setIsEditModalOpen(true);
            }
        } else {
            if (existingEntry) {
                setEditingEntry({
                    id: existingEntry.id,
                    day: existingEntry.day_of_week,
                    period: existingEntry.period,
                    studentGroup: existingEntry.student_group,
                    subject: existingEntry.subject,
                    teacher: existingEntry.teacher,
                    classroom: existingEntry.classroom,
                    covering_teacher: existingEntry.covering_teacher || "",
                    isNew: false
                });
                setIsEditModalOpen(true);
            } else {
                setEditingEntry({
                    day: day.id,
                    period: period.id,
                    studentGroup: group.id,
                    subject: "",
                    teacher: "",
                    classroom: "",
                    covering_teacher: "",
                    isNew: true
                });
                setIsEditModalOpen(true);
            }
        }
    };

    const handleSaveCoverTeacher = (teacherId) => {
        if (!coverModalEntry) return;

        const updatedEntries = entries.map(entry => {
            if (Number(entry.day_of_week) === Number(coverModalEntry.day.id) &&
                Number(entry.period) === Number(coverModalEntry.period) &&
                Number(entry.student_group) === Number(coverModalEntry.studentGroup)) {

                return {
                    ...entry,
                    covering_teacher: teacherId || null
                };
            }
            return entry;
        });

        setEntries(updatedEntries);
        setHasUnsavedChanges(true);
        setCoverModalEntry(null);

        if (teacherId) {
            toast.success("Cover teacher assigned successfully!");
        } else {
            toast.success("Cover teacher removed successfully!");
        }
    };

    const handleCopyEntry = (entry) => {
        setCopiedEntry({
            ...entry,
            id: undefined // Remove ID to make it a new entry
        });
        toast.success(`Copied "${getSubjectName(entry.subject)}" for ${getGroupName(entry.student_group)}`);
    };

    const handlePasteEntry = (dayId, periodId, groupId) => {
        if (!copiedEntry) {
            toast.error("No entry copied to paste");
            return;
        }

        // Check for conflicts
        const teacherConflict = entries.find(e =>
            e.day_of_week === dayId &&
            e.period === periodId &&
            e.teacher === copiedEntry.teacher
        );

        const classroomConflict = entries.find(e =>
            e.day_of_week === dayId &&
            e.period === periodId &&
            e.classroom === copiedEntry.classroom
        );

        if (teacherConflict) {
            toast.error(`Teacher ${getTeacherName(copiedEntry.teacher)} already booked at this time`);
            return;
        }

        if (classroomConflict) {
            toast.error(`Classroom ${getClassroomName(copiedEntry.classroom)} already booked at this time`);
            return;
        }

        // Check teacher availability
        if (!isTeacherAvailable(copiedEntry.teacher, dayId, periodId)) {
            if (!confirm("This teacher is not available at this time. Paste anyway?")) {
                return;
            }
        }

        const newEntry = {
            ...copiedEntry,
            day_of_week: dayId,
            period: periodId,
            student_group: groupId,
            id: `temp-${Date.now()}`
        };

        setEntries([...entries, newEntry]);
        setHasUnsavedChanges(true);
        setCopiedEntry(null);
        toast.success("Entry pasted successfully!");
    };

    const handleRemoveEntry = (dayId, periodId, groupId) => {
        console.log("Removing entry for:", { dayId, periodId, groupId });

        if (!confirm("Remove this entry?")) return;

        // Create a new array without the matching entry
        const newEntries = entries.filter(entry => {
            // Convert all values to numbers for comparison
            const entryDay = Number(entry.day_of_week);
            const entryPeriod = Number(entry.period);
            const entryGroup = Number(entry.student_group);

            const targetDay = Number(dayId);
            const targetPeriod = Number(periodId);
            const targetGroup = Number(groupId);

            // Return true to KEEP entries that DON'T match
            return !(entryDay === targetDay &&
                entryPeriod === targetPeriod &&
                entryGroup === targetGroup);
        });

        if (entries.length === newEntries.length) {
            console.log("No entry found to remove");
            toast.error("Entry not found or already removed");
            return;
        }

        console.log(`Success! Removed 1 entry. Before: ${entries.length}, After: ${newEntries.length}`);
        setEntries(newEntries);
        setHasUnsavedChanges(true);
        toast.success("Entry removed successfully!");
    };

    const handleSaveEdit = () => {
        // Validate required fields
        if (!editingEntry.subject) {
            toast.error("Please select a subject");
            return;
        }

        if (!editingEntry.teacher) {
            toast.error("Please select a teacher");
            return;
        }

        if (!editingEntry.classroom) {
            toast.error("Please select a classroom");
            return;
        }

        // Check teacher availability
        if (!isTeacherAvailable(editingEntry.teacher, editingEntry.day, editingEntry.period)) {
            if (!confirm("This teacher is not available at this time. Save anyway?")) {
                return;
            }
        }

        // Check for conflicts - EXCLUDE temporary entries from conflict check
        const conflictingEntry = entries.find(entry => {
            // Skip if this is the same entry we're editing
            if (editingEntry.id && entry.id === editingEntry.id) return false;

            // Skip temporary entries in conflict check
            if (entry.id?.toString().startsWith('temp-')) return false;

            return (
                Number(entry.day_of_week) === Number(editingEntry.day) &&
                Number(entry.period) === Number(editingEntry.period) &&
                (Number(entry.teacher) === Number(editingEntry.teacher) ||
                    Number(entry.classroom) === Number(editingEntry.classroom))
            );
        });

        if (conflictingEntry) {
            if (Number(conflictingEntry.teacher) === Number(editingEntry.teacher)) {
                toast.error(`Teacher ${getTeacherName(editingEntry.teacher)} already booked at this time`);
                return;
            } else {
                toast.error(`Classroom ${getClassroomName(editingEntry.classroom)} already booked at this time`);
                return;
            }
        }

        // Create new entry object
        const newEntry = {
            day_of_week: Number(editingEntry.day),
            period: Number(editingEntry.period),
            student_group: Number(editingEntry.studentGroup),
            subject: Number(editingEntry.subject),
            teacher: Number(editingEntry.teacher),
            classroom: Number(editingEntry.classroom),
            covering_teacher: editingEntry.covering_teacher ? Number(editingEntry.covering_teacher) : null
        };

        // Add ID
        if (editingEntry.isNew) {
            newEntry.id = `temp-${Date.now()}`;
        } else {
            newEntry.id = editingEntry.id;
        }

        // Remove existing entry if editing
        const filteredEntries = entries.filter(entry => {
            if (editingEntry.isNew) return true; // Keep all entries for new
            return entry.id !== editingEntry.id; // Remove the old version
        });

        // Add new entry
        const updatedEntries = [...filteredEntries, newEntry];

        console.log("Updated entries:", updatedEntries);
        setEntries(updatedEntries);
        setHasUnsavedChanges(true);
        setIsEditModalOpen(false);
        setEditingEntry(null);
        toast.success(editingEntry.isNew ? "Entry added successfully!" : "Entry updated successfully!");
    };

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Calendar className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to view timetables.</p>
                <button
                    onClick={() => navigate("/school")}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                    Go to School Setup
                </button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex items-center justify-center">
                <LoadingSpinner size="lg" text="Loading timetable..." />
            </div>
        );
    }

    // Get available subjects for a group (like reference file)
    const getAvailableSubjectsForGroup = (groupId) => {
        const reqs = groupRequirements[groupId] || [];
        const allowedSubjectIds = reqs.map(req => req.subject);

        if (allowedSubjectIds.length === 0) return subjects;

        return subjects.filter(subject => allowedSubjectIds.includes(subject.id));
    };

    // Get available teachers for a subject (like reference file)
    const getAvailableTeachersForSubject = (subjectId) => {
        if (!subjectId) return teachers;

        return teachers.filter(teacher =>
            teacher.subjects?.includes(subjectId)
        );
    };

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                        <Calendar className="h-7 w-7 text-indigo-600" />
                        Visual Timetable
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Timetable ID: {timetableId}
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <select
                        value={selectedSchedule?.id || ""}
                        onChange={(e) => {
                            const scheduleId = e.target.value;
                            const schedule = allSchedules.find(s => s.id == scheduleId);
                            if (schedule) {
                                setSelectedSchedule(schedule);
                                setPeriods(schedule.periods || []);
                            }
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                    >
                        <option value="">Select Schedule</option>
                        {allSchedules.map(schedule => (
                            <option key={schedule.id} value={schedule.id}>
                                {schedule.name} ({schedule.periods?.length || 0} periods)
                            </option>
                        ))}
                    </select>

                    <button
                        onClick={handleGenerate}
                        disabled={actionLoading}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg shadow-md font-medium transition disabled:opacity-50"
                    >
                        <Plus size={18} />
                        Generate
                    </button>
                    <button
                        onClick={() => setShowCover(!showCover)}
                        className={`flex items-center justify-center gap-2 px-4 py-2 border rounded-lg shadow font-medium transition ${
                            showCover
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-indigo-600 border-indigo-600 hover:bg-indigo-50'
                        }`}
                    >
                        <Users size={18} />
                        {showCover ? "Hide Cover Mode" : "Show Cover Mode"}
                    </button>
                </div>
            </div>

            {/*{success && (*/}
            {/*    <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">*/}
            {/*        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />*/}
            {/*        <div className="flex-1">*/}
            {/*            <p className="text-green-800 font-medium">{success}</p>*/}
            {/*        </div>*/}
            {/*        <button onClick={() => toast.success("")} className="text-green-600 hover:text-green-800">*/}
            {/*            <XCircle size={18} />*/}
            {/*        </button>*/}
            {/*    </div>*/}
            {/*)}*/}

            {/*{error && (*/}
            {/*    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">*/}
            {/*        <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />*/}
            {/*        <div className="flex-1">*/}
            {/*            <p className="text-red-800 font-medium">{error}</p>*/}
            {/*        </div>*/}
            {/*        <button onClick={() => toast.error("")} className="text-red-600 hover:text-red-800">*/}
            {/*            <XCircle size={18} />*/}
            {/*        </button>*/}
            {/*    </div>*/}
            {/*)}*/}

            {hasUnsavedChanges && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-yellow-800 font-medium">You have unsaved changes</p>
                        <p className="text-yellow-700 text-sm mt-1">
                            Click "Save Timetable" to save your changes
                        </p>
                    </div>
                </div>
            )}

            {unmetRequirements.length > 0 && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowUnmet(!showUnmet)}>
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-red-600" />
                            <span className="font-medium text-red-800">
                    Unmet Requirements ({unmetRequirements.length})
                </span>
                        </div>
                        <span className="text-red-600">
                {showUnmet ? "▲" : "▼"}
            </span>
                    </div>
                    {showUnmet && (
                        <div className="mt-3 space-y-2">
                            {unmetRequirements.map((req, index) => (
                                <div key={index} className="text-sm text-red-700">
                                    • <strong>{getGroupName(req.groupId)}</strong>: Needs <strong>{req.required - req.current}</strong> more lectures of <strong>{req.subjectName}</strong> (currently: {req.current})
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {overmetRequirements.length > 0 && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowOvermet(!showOvermet)}>
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-yellow-600" />
                            <span className="font-medium text-yellow-800">
                    Over-assigned Subjects ({overmetRequirements.length})
                </span>
                        </div>
                        <span className="text-yellow-600">
                {showOvermet ? "▲" : "▼"}
            </span>
                    </div>
                    {showOvermet && (
                        <div className="mt-3 space-y-2">
                            {overmetRequirements.map((req, index) => (
                                <div key={index} className="text-sm text-yellow-700">
                                    • <strong>{getGroupName(req.groupId)}</strong>: Has <strong>{req.current}</strong> lectures of <strong>{req.subjectName}</strong> (required: {req.required})
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden mb-8">
                {DAYS.map(day => (
                    <div key={day.id} className="border-b last:border-b-0">
                        <div className="bg-gray-50 px-6 py-3 border-b">
                            <h2 className="text-lg font-semibold text-gray-800">{day.name}</h2>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead className="bg-indigo-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                                        Group / Period
                                    </th>
                                    {periods.map(period => (
                                        <th key={period.id} className="px-4 py-3 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider">
                                            <div>{period.name}</div>
                                            <div className="text-xs text-gray-500 font-normal">
                                                {period.start_time} - {period.end_time}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {studentGroups.map(group => (
                                    <tr key={group.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{group.name}</div>
                                        </td>
                                        {periods.map(period => {
                                            const entry = getEntry(day.id, period.id, group.id);

                                            return (
                                                <td
                                                    key={period.id}
                                                    className={`px-4 py-3 border text-center cursor-pointer ${
                                                        showCover && !entry
                                                            ? "bg-gray-100"
                                                            : "hover:bg-indigo-50"
                                                    }`}
                                                    onClick={() => handleAddEntry(day, period, group)}
                                                >
                                                    {entry ? (
                                                        <div className="space-y-1">
                                                            {showCover ? (
                                                                <div className="text-xs space-y-1">
                                                                    <div className="text-gray-600">
                                                                        <div className="font-medium">Original: {getTeacherName(entry.teacher)}</div>
                                                                        <div className="mt-1">
                                                                            <span className="font-medium">Cover: </span>
                                                                            {entry.covering_teacher
                                                                                ? getTeacherName(entry.covering_teacher)
                                                                                : <span className="text-gray-400 italic">No cover assigned</span>
                                                                            }
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex justify-end gap-1 mt-2">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleCopyEntry(entry);
                                                                            }}
                                                                            className="text-gray-400 hover:text-blue-600 p-1"
                                                                            title="Copy entry"
                                                                        >
                                                                            <Copy size={14} />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                console.log("Delete button clicked for:", {
                                                                                    dayId: day.id,
                                                                                    periodId: period.id,
                                                                                    groupId: group.id,
                                                                                    dayIdType: typeof day.id,
                                                                                    periodIdType: typeof period.id,
                                                                                    groupIdType: typeof group.id
                                                                                });
                                                                                handleRemoveEntry(day.id, period.id, group.id);
                                                                            }}
                                                                            className="text-gray-400 hover:text-red-600 p-1"
                                                                            title="Remove entry"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div className="flex justify-end gap-1 mb-1">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleCopyEntry(entry);
                                                                            }}
                                                                            className="text-gray-400 hover:text-blue-600 p-1"
                                                                            title="Copy entry"
                                                                        >
                                                                            <Copy size={14} />
                                                                        </button>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleRemoveEntry(day.id, period.id, group.id);
                                                                            }}
                                                                            className="text-gray-400 hover:text-red-600 p-1"
                                                                            title="Remove entry"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </div>
                                                                    <div className="font-medium text-gray-900 text-sm">
                                                                        {getSubjectName(entry.subject)}
                                                                    </div>
                                                                    <div className="text-xs text-gray-600">
                                                                        {getTeacherName(entry.teacher)}
                                                                        {entry.covering_teacher && (
                                                                            <span className="ml-1 text-blue-600">
                                                                                (Cover: {getTeacherName(entry.covering_teacher)})
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-xs text-gray-500">
                                                                        {getClassroomName(entry.classroom)}
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="text-gray-400 text-sm py-2">
                                                            {copiedEntry ? (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handlePasteEntry(day.id, period.id, group.id);
                                                                    }}
                                                                    className="text-green-600 hover:text-green-800 px-2 py-1 rounded bg-green-50 hover:bg-green-100"
                                                                >
                                                                    Paste 📥
                                                                </button>
                                                            ) : (
                                                                "—"
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6 border-t border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>Entries: {entries.length}</span>
                    <span>•</span>
                    <span>Groups: {studentGroups.length}</span>
                    <span>•</span>
                    <span>Periods: {periods.length}</span>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={handleSave}
                        disabled={!hasUnsavedChanges || actionLoading}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save size={18} />
                        Save Timetable
                    </button>

                    <div className="flex gap-3">
                        <div className="relative">
                            <select
                                disabled={exporting}
                                onChange={(e) => {
                                    const type = e.target.value;
                                    if (!type) return;

                                    handleExport(type);
                                    e.target.value = '';
                                }}
                                className={`w-60 px-6 py-3 rounded shadow text-white cursor-pointer transition-colors appearance-none text-center font-medium ${
                                    exporting ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                                }`}
                                defaultValue=""
                            >
                                <option value="" disabled>
                                    {exporting ? "⌛ Generating..." : "Export Timetable"}
                                </option>
                                <option value="grade" className="text-gray-800 bg-white">Export by Grade</option>
                                <option value="teacher" className="text-gray-800 bg-white">Export by Teacher</option>
                                <option value="room" className="text-gray-800 bg-white">Export by Room</option>
                            </select>
                        </div>

                        <button
                            onClick={() => navigate(`/school/timetables`)}
                            className="px-6 py-3 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition"
                        >
                            Back to Timetables
                        </button>
                    </div>
                </div>
            </div>

            {/* Edit Modal - FIXED with proper subject/teacher filtering */}
            {isEditModalOpen && editingEntry && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-800">
                                    {editingEntry.isNew ? "Add Entry" : "Edit Entry"}
                                </h2>
                                <button
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="space-y-4">
                                {!editingEntry.isNew && (
                                    <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                                        <div className="text-sm text-blue-800">
                                            <div><strong>Day:</strong> {DAYS.find(d => d.id === editingEntry.day)?.name}</div>
                                            <div><strong>Group:</strong> {getGroupName(editingEntry.studentGroup)}</div>
                                            <div><strong>Period:</strong> {periods.find(p => p.id === editingEntry.period)?.name} ({getPeriodTime(editingEntry.period)})</div>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Subject *
                                    </label>
                                    <select
                                        value={editingEntry.subject || ""}
                                        onChange={(e) => {
                                            const subjectId = e.target.value ? parseInt(e.target.value) : "";
                                            setEditingEntry({
                                                ...editingEntry,
                                                subject: subjectId,
                                                teacher: "" // Reset teacher when subject changes
                                            });
                                        }}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                                    >
                                        <option value="">Select Subject</option>
                                        {getAvailableSubjectsForGroup(editingEntry.studentGroup).map(subject => (
                                            <option key={subject.id} value={subject.id}>
                                                {subject.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Teacher *
                                        {editingEntry.teacher && !isTeacherAvailable(editingEntry.teacher, editingEntry.day, editingEntry.period) && (
                                            <span className="ml-2 text-xs text-red-600">(Not available at this time)</span>
                                        )}
                                    </label>
                                    <select
                                        value={editingEntry.teacher || ""}
                                        onChange={(e) => {
                                            const teacherId = e.target.value ? parseInt(e.target.value) : "";
                                            const isAvailable = teacherId ? isTeacherAvailable(teacherId, editingEntry.day, editingEntry.period) : true;

                                            if (!isAvailable && !confirm("This teacher is not available at this time. Continue anyway?")) {
                                                return;
                                            }

                                            setEditingEntry({...editingEntry, teacher: teacherId});
                                        }}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                                        disabled={!editingEntry.subject}
                                    >
                                        <option value="">Select Teacher</option>
                                        {getAvailableTeachersForSubject(editingEntry.subject).map(teacher => {
                                            const isAvailable = isTeacherAvailable(teacher.id, editingEntry.day, editingEntry.period);
                                            return (
                                                <option
                                                    key={teacher.id}
                                                    value={teacher.id}
                                                    className={!isAvailable ? "bg-red-50 text-red-700" : ""}
                                                >
                                                    {teacher.name} {!isAvailable ? "(Not Available)" : ""}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    {!editingEntry.subject && (
                                        <p className="mt-1 text-xs text-gray-500">Please select a subject first</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Classroom *
                                    </label>
                                    <select
                                        value={editingEntry.classroom || ""}
                                        onChange={(e) => setEditingEntry({
                                            ...editingEntry,
                                            classroom: e.target.value ? parseInt(e.target.value) : ""
                                        })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                                    >
                                        <option value="">Select Classroom</option>
                                        {classrooms.map(classroom => (
                                            <option key={classroom.id} value={classroom.id}>
                                                {classroom.name} (Capacity: {classroom.capacity})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {!editingEntry.isNew && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Cover Teacher (Optional)
                                            {editingEntry.covering_teacher && (
                                                <span className="ml-2 text-xs text-green-600">Currently assigned</span>
                                            )}
                                        </label>
                                        <select
                                            value={editingEntry.covering_teacher || ""}
                                            onChange={(e) => setEditingEntry({
                                                ...editingEntry,
                                                covering_teacher: e.target.value ? parseInt(e.target.value) : ""
                                            })}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                                        >
                                            <option value="">No Cover Teacher</option>
                                            {teachers
                                                .filter(teacher => teacher.id !== editingEntry.teacher)
                                                .map(teacher => (
                                                    <option key={teacher.id} value={teacher.id}>
                                                        {teacher.name}
                                                    </option>
                                                ))
                                            }
                                        </select>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Optional: Assign a substitute teacher for this session
                                        </p>
                                    </div>
                                )}

                                <div className="flex justify-end gap-3 pt-6">
                                    <button
                                        onClick={() => setIsEditModalOpen(false)}
                                        className="px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveEdit}
                                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-md transition"
                                    >
                                        {editingEntry.isNew ? "Add Entry" : "Update Entry"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {coverModalEntry && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-800">
                                    Assign Cover Teacher
                                </h2>
                                <button
                                    onClick={() => setCoverModalEntry(null)}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                                <div className="text-sm text-blue-800">
                                    <div>Day: {DAYS.find(d => d.id === coverModalEntry.day.id)?.name}</div>
                                    <div>Group: {getGroupName(coverModalEntry.studentGroup)}</div>
                                    <div>Period: {periods.find(p => p.id === coverModalEntry.period)?.name}</div>
                                    <div className="mt-2">
                                        <div><strong>Current Teacher:</strong> {getTeacherName(coverModalEntry.entry.teacher)}</div>
                                        <div><strong>Current Cover:</strong> {
                                            coverModalEntry.entry.covering_teacher
                                                ? getTeacherName(coverModalEntry.entry.covering_teacher)
                                                : "None"
                                        }</div>
                                    </div>
                                </div>
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Select Cover Teacher
                                </label>
                                <select
                                    value={coverModalEntry.selectedTeacher || coverModalEntry.entry.covering_teacher || ""}
                                    onChange={(e) => setCoverModalEntry({
                                        ...coverModalEntry,
                                        selectedTeacher: e.target.value ? parseInt(e.target.value) : ""
                                    })}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                                >
                                    <option value="">No Cover Teacher (Remove existing)</option>
                                    {teachers
                                        .filter(teacher => teacher.id !== coverModalEntry.entry.teacher)
                                        .map(teacher => (
                                            <option key={teacher.id} value={teacher.id}>
                                                {teacher.name}
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setCoverModalEntry(null)}
                                    className="px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        const teacherId = coverModalEntry.selectedTeacher === "" ? null : coverModalEntry.selectedTeacher;
                                        handleSaveCoverTeacher(teacherId);
                                    }}
                                    className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-md transition"
                                >
                                    {coverModalEntry.selectedTeacher === "" ? "Remove Cover" : "Assign Cover"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}