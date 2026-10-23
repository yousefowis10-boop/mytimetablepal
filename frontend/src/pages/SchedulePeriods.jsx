import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { Clock, Plus, Trash2, Edit, AlertCircle, CheckCircle, XCircle, ArrowLeft, Users, Check } from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchSchedulePeriods,
    createSchedulePeriod,
    updateSchedulePeriod,
    deleteSchedulePeriod,
    fetchTeachers,
    fetchTeacherAvailabilityPeriod,
    updateTeacherAvailabilityPeriod
} from "../services/api";

export default function SchedulePeriods() {
    const { scheduleId } = useParams();
    const navigate = useNavigate();
    const { school } = useSchool();

    const [periods, setPeriods] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);
    const [editingPeriod, setEditingPeriod] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);

    const [form, setForm] = useState({
        name: "",
        start_time: "",
        end_time: "",
        type: "lecture",
        order: 1,
    });

    const [selectedPeriod, setSelectedPeriod] = useState(null);
    const [teachers, setTeachers] = useState([]);
    const [availableTeachers, setAvailableTeachers] = useState(new Set());

// Fix the useEffect that loads periods
    useEffect(() => {
        if (!school || !scheduleId) {
            setLoading(false);
            return;
        }

        const loadPeriods = async () => {
            try {
                setLoading(true);
                setError("");
                const response = await fetchSchedulePeriods(school.id, scheduleId);

                console.log("Periods response:", response); // Debug

                // FIX: Handle API response format
                let periodsData;
                if (Array.isArray(response)) {
                    periodsData = response;
                } else if (response && response.data && Array.isArray(response.data)) {
                    periodsData = response.data;
                } else if (response && response.data) {
                    periodsData = [response.data];
                } else if (response && Array.isArray(response.periods)) {
                    periodsData = response.periods;
                } else {
                    periodsData = [];
                }

                setPeriods(periodsData);
            } catch (err) {
                console.error("Failed to load periods:", err);
                setError("Failed to load schedule periods. Please try again.");
                setPeriods([]);
            } finally {
                setLoading(false);
            }
        };

        loadPeriods();
    }, [school, scheduleId]);

    useEffect(() => {
        if (!school) {
            setError("Please select or create a school first!");
            setTimeout(() => {
                navigate("/school");
            }, 2000);
        }
    }, [school, navigate]);

    useEffect(() => {
        if (error || success) {
            const timer = setTimeout(() => {
                setError("");
                setSuccess("");
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [error, success]);

    const resetForm = () => {
        setForm({
            name: "",
            start_time: "",
            end_time: "",
            type: "lecture",
            order: periods.length + 1,
        });
        setEditingPeriod(null);
        setIsModalOpen(false);
    };

// Fix the handleSubmit function
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!school || !scheduleId) {
            setError("Missing school or schedule information!");
            return;
        }

        if (!form.name.trim()) {
            setError("Period name is required");
            return;
        }

        if (!form.start_time || !form.end_time) {
            setError("Both start and end times are required");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const payload = {
                ...form,
                schedule: parseInt(scheduleId)
            };

            console.log("Submitting payload:", payload);

            if (editingPeriod) {
                const response = await updateSchedulePeriod(
                    school.id,
                    scheduleId,
                    editingPeriod.id,
                    payload
                );

                console.log("Update response:", response);

                const updatedPeriodData = response.data || response;

                setPeriods(periods.map(p =>
                    p.id === editingPeriod.id ? updatedPeriodData : p
                ));

                setSuccess(`Period "${form.name}" updated successfully!`);
                resetForm();

            } else {
                const response = await createSchedulePeriod(
                    school.id,
                    scheduleId,
                    payload
                );

                console.log("Create response:", response); // Debug

                const newPeriodData = response.data || response;

                setPeriods([...periods, newPeriodData]);
                setSuccess(`Period "${form.name}" created successfully!`);
                resetForm();
            }
        } catch (err) {
            console.error("Period save error:", err);
            setError(err.message || "Failed to save period. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async (periodId, periodName) => {
        if (!confirm(`Are you sure you want to delete "${periodName}"?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteSchedulePeriod(school.id, scheduleId, periodId);

            // Refresh the entire list
            const refreshedResponse = await fetchSchedulePeriods(school.id, scheduleId);
            let refreshedPeriods;

            if (Array.isArray(refreshedResponse)) {
                refreshedPeriods = refreshedResponse;
            } else if (refreshedResponse && refreshedResponse.data) {
                refreshedPeriods = Array.isArray(refreshedResponse.data)
                    ? refreshedResponse.data
                    : [];
            } else {
                refreshedPeriods = [];
            }

            setPeriods(refreshedPeriods);
            setSelectedIds(selectedIds.filter(id => id !== periodId));
            setSuccess(`Period "${periodName}" deleted successfully!`);

        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete period. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) {
            setError("No periods selected!");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedIds.length} period(s)?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const deletePromises = selectedIds.map(id =>
                deleteSchedulePeriod(school.id, scheduleId, id)
            );

            await Promise.all(deletePromises);

            // Refresh the entire list after bulk delete
            const refreshedResponse = await fetchSchedulePeriods(school.id, scheduleId);
            let refreshedPeriods;

            if (Array.isArray(refreshedResponse)) {
                refreshedPeriods = refreshedResponse;
            } else if (refreshedResponse && refreshedResponse.data) {
                refreshedPeriods = Array.isArray(refreshedResponse.data)
                    ? refreshedResponse.data
                    : [];
            } else {
                refreshedPeriods = [];
            }

            setPeriods(refreshedPeriods);
            setSelectedIds([]);
            setSuccess(`${selectedIds.length} period(s) deleted successfully!`);

        } catch (err) {
            console.error("Bulk delete error:", err);
            setError("Failed to delete some periods. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEdit = (period) => {
        setForm({
            name: period.name,
            start_time: period.start_time,
            end_time: period.end_time,
            type: period.type,
            order: period.order,
        });
        setEditingPeriod(period);
        setIsModalOpen(true);
    };


    const openAvailabilityModal = async (period) => {
        if (!school) {
            setError("School not selected");
            return;
        }

        setSelectedPeriod(period);
        setActionLoading(true);
        setError("");

        try {
            const [teachersData, availabilityData] = await Promise.all([
                fetchTeachers(school.id),
                fetchTeacherAvailabilityPeriod(period.id)
            ]);

            setTeachers(teachersData || []);

            const availableSet = new Set();
            if (availabilityData && Array.isArray(availabilityData)) {
                availabilityData.forEach(teacher => {
                    if (teacher.available) {
                        availableSet.add(teacher.id);
                    }
                });
            }

            setAvailableTeachers(availableSet);
            setAvailabilityModalOpen(true);

        } catch (err) {
            console.error("Failed loading availability:", err);
            setError("Failed to load teacher availability. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const toggleAvailability = (teacherId) => {
        if (!teacherId || typeof teacherId !== "number") return;

        setAvailableTeachers(prev => {
            const updated = new Set(prev);
            if (updated.has(teacherId)) {
                updated.delete(teacherId);
            } else {
                updated.add(teacherId);
            }
            return updated;
        });
    };

    const saveAvailability = async () => {
        if (!selectedPeriod || !school) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await updateTeacherAvailabilityPeriod(
                selectedPeriod.id,
                Array.from(availableTeachers)
            );

            setSuccess(`Availability for "${selectedPeriod.name}" updated successfully!`);
            setAvailabilityModalOpen(false);

        } catch (err) {
            console.error("Failed to save availability:", err);
            setError(err.message || "Failed to save teacher availability. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const formatTime = (time) => {
        if (!time) return "";
        const [hours, minutes] = time.split(":");
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? "PM" : "AM";
        const hour12 = hour % 12 || 12;
        return `${hour12}:${minutes} ${ampm}`;
    };

    const getTypeDisplay = (type) => {
        const types = {
            lecture: "Lecture",
            break: "Break",
            lab: "Lab",
            other: "Other"
        };
        return types[type] || type;
    };

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Clock className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage schedule periods.</p>
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
                <LoadingSpinner size="lg" text="Loading schedule periods..." />
            </div>
        );
    }

    const sortedPeriods = [...periods].sort((a, b) => a.order - b.order);

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                            <Clock className="h-7 w-7 text-purple-600" />
                            Schedule Periods
                        </h1>
                    </div>
                    <p className="text-gray-600 ml-10">
                        Managing periods for Schedule ID: {scheduleId}
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    {selectedIds.length > 0 && (
                        <button
                            onClick={handleBulkDelete}
                            disabled={actionLoading}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg shadow font-medium transition disabled:opacity-50"
                        >
                            <Trash2 size={18} />
                            Delete Selected ({selectedIds.length})
                        </button>
                    )}
                    <button
                        onClick={() => {
                            resetForm();
                            setForm(prev => ({ ...prev, order: periods.length + 1 }));
                            setIsModalOpen(true);
                        }}
                        disabled={actionLoading}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg shadow-md font-medium transition disabled:opacity-50"
                    >
                        <Plus size={18} />
                        Add Period
                    </button>
                </div>
            </div>

            {success && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-green-800 font-medium">{success}</p>
                    </div>
                    <button onClick={() => setSuccess("")} className="text-green-600 hover:text-green-800">
                        <XCircle size={18} />
                    </button>
                </div>
            )}

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-red-800 font-medium">{error}</p>
                    </div>
                    <button onClick={() => setError("")} className="text-red-600 hover:text-red-800">
                        <XCircle size={18} />
                    </button>
                </div>
            )}

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {sortedPeriods.length === 0 ? (
                    <div className="text-center py-12">
                        <Clock className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            No periods added yet
                        </h3>
                        <p className="text-gray-600 mb-6">
                            Add periods to define the daily schedule structure
                        </p>
                        <button
                            onClick={() => {
                                resetForm();
                                setIsModalOpen(true);
                            }}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                        >
                            Add First Period
                        </button>
                    </div>
                ) : (
                    <>
                        {selectedIds.length > 0 && (
                            <div className="bg-purple-50 border-b border-purple-200 px-6 py-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-purple-700 font-medium">
                                        {selectedIds.length} period(s) selected
                                    </span>
                                    <button
                                        onClick={() => setSelectedIds([])}
                                        className="text-sm text-purple-600 hover:text-purple-800 hover:underline"
                                    >
                                        Clear Selection
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-12">
                                        <input
                                            type="checkbox"
                                            onChange={(e) =>
                                                setSelectedIds(
                                                    e.target.checked ? sortedPeriods.map(p => p.id) : []
                                                )
                                            }
                                            checked={selectedIds.length === sortedPeriods.length && sortedPeriods.length > 0}
                                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                            disabled={actionLoading}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-16">
                                        Order
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Period Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Time
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Type
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider text-right">
                                        Actions
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {sortedPeriods.map((period) => (
                                    <tr
                                        key={period.id}
                                        className={`hover:bg-gray-50 transition-colors ${
                                            selectedIds.includes(period.id) ? 'bg-purple-50' : ''
                                        }`}
                                    >
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(period.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked)
                                                        setSelectedIds([...selectedIds, period.id]);
                                                    else
                                                        setSelectedIds(selectedIds.filter(id => id !== period.id));
                                                }}
                                                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                disabled={actionLoading}
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-bold text-gray-900">
                                                {period.order}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{period.name}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <div className="text-sm text-gray-700">
                                                    {formatTime(period.start_time)} - {formatTime(period.end_time)}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {period.start_time} - {period.end_time}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                                <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-full ${
                                                    period.type === 'break' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                                        period.type === 'lab' ? 'bg-green-100 text-green-800 border border-green-200' :
                                                            period.type === 'lecture' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                                                                'bg-gray-100 text-gray-800 border border-gray-200'
                                                }`}>
                                                    {getTypeDisplay(period.type)}
                                                </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => openAvailabilityModal(period)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-green-500 text-green-700 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Users size={14} />
                                                    Availability
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(period)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Edit size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(period.id, period.name)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-red-400 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Trash2 size={14} />
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                            <div className="flex items-center justify-between">
                                <div className="text-sm text-gray-600">
                                    Showing {sortedPeriods.length} period(s) in order
                                </div>
                                {selectedIds.length > 0 && (
                                    <div className="text-sm font-medium text-purple-700">
                                        {selectedIds.length} selected
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-800">
                                    {editingPeriod ? "Edit Period" : "Add Period"}
                                </h2>
                                <button
                                    onClick={resetForm}
                                    className="text-gray-400 hover:text-gray-600"
                                    disabled={actionLoading}
                                >
                                    ✕
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Period Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Period 1, Morning Assembly, Lunch Break"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Start Time *
                                        </label>
                                        <input
                                            type="time"
                                            value={form.start_time}
                                            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition disabled:opacity-50"
                                            required
                                            disabled={actionLoading}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            End Time *
                                        </label>
                                        <input
                                            type="time"
                                            value={form.end_time}
                                            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition disabled:opacity-50"
                                            required
                                            disabled={actionLoading}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Period Type
                                    </label>
                                    <select
                                        value={form.type}
                                        onChange={(e) => setForm({ ...form, type: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition disabled:opacity-50"
                                        disabled={actionLoading}
                                    >
                                        <option value="lecture">Lecture</option>
                                        <option value="break">Break</option>
                                        <option value="lab">Lab</option>
                                        <option value="other">Other</option>
                                    </select>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Helps in timetable generation and resource allocation
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Display Order *
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="Order in schedule"
                                        value={form.order}
                                        onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) || 1 })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Determines the position of this period in the daily schedule
                                    </p>
                                </div>

                                <div className="flex justify-end gap-3 pt-6">
                                    <button
                                        type="button"
                                        onClick={resetForm}
                                        className="px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
                                        disabled={actionLoading}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={actionLoading}
                                        className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {editingPeriod ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingPeriod ? "Update Period" : "Create Period"
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {availabilityModalOpen && selectedPeriod && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                    <Users className="h-5 w-5 text-green-600" />
                                    Teacher Availability
                                </h2>
                                <button
                                    onClick={() => setAvailabilityModalOpen(false)}
                                    className="text-gray-400 hover:text-gray-600"
                                    disabled={actionLoading}
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Clock className="h-5 w-5 text-blue-600" />
                                    <div>
                                        <p className="font-medium text-blue-800">{selectedPeriod.name}</p>
                                        <p className="text-sm text-blue-700">
                                            {formatTime(selectedPeriod.start_time)} - {formatTime(selectedPeriod.end_time)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                                <table className="min-w-full">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                                            Teacher
                                        </th>
                                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">
                                            Available
                                        </th>
                                    </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                    {teachers.length === 0 ? (
                                        <tr>
                                            <td colSpan="2" className="px-4 py-8 text-center text-gray-500">
                                                No teachers found
                                            </td>
                                        </tr>
                                    ) : (
                                        teachers.map((teacher) => (
                                            <tr key={teacher.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                                                    <div className="text-xs text-gray-500">
                                                        {(teacher.subject_names || []).join(", ") || "No subjects"}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <label className="inline-flex items-center cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={availableTeachers.has(teacher.id)}
                                                            onChange={() => toggleAvailability(teacher.id)}
                                                            disabled={actionLoading}
                                                            className="h-5 w-5 text-green-600 rounded border-gray-300 focus:ring-green-500"
                                                        />
                                                    </label>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex justify-between items-center mt-4 text-sm text-gray-600">
                                <div>
                                    {availableTeachers.size} of {teachers.length} teachers available
                                </div>
                                <div className="flex items-center gap-1">
                                    <Check className="h-4 w-4 text-green-500" />
                                    <span>Available</span>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6">
                                <button
                                    onClick={() => setAvailabilityModalOpen(false)}
                                    disabled={actionLoading}
                                    className="px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={saveAvailability}
                                    disabled={actionLoading}
                                    className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                >
                                    {actionLoading ? (
                                        <>
                                            <LoadingSpinner size="sm" color="light" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Check size={18} />
                                            Save Availability
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}