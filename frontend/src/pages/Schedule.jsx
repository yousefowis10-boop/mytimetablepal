import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { Calendar, Plus, Trash2, Edit, Search, AlertCircle, CheckCircle, XCircle, Clock, Check, X } from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule
} from "../services/api";

export default function Schedule() {
    const navigate = useNavigate();
    const { school } = useSchool();
    const [schedules, setSchedules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form, setForm] = useState({ name: "", is_active: true });
    const [editingSchedule, setEditingSchedule] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);

    useEffect(() => {
        if (!school) {
            setLoading(false);
            return;
        }

        const loadSchedules = async () => {
            try {
                setLoading(true);
                setError("");
                const schedulesData = await fetchSchedules(school.id);
                setSchedules(schedulesData || []);
            } catch (err) {
                console.error("Failed to load schedules:", err);
                setError("Failed to load schedules. Please try again.");
            } finally {
                setLoading(false);
            }
        };

        loadSchedules();
    }, [school]);

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
        setForm({ name: "", is_active: true });
        setEditingSchedule(null);
        setIsModalOpen(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!school) {
            setError("Please select or create a school first!");
            return;
        }

        if (!form.name.trim()) {
            setError("Schedule name is required");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const payload = {
                name: form.name.trim(),
                is_active: form.is_active,
                school: school.id
            };

            if (editingSchedule) {
                const updatedSchedule = await updateSchedule(
                    school.id,
                    editingSchedule.id,
                    payload
                );

                setSchedules(schedules.map(s =>
                    s.id === editingSchedule.id ? updatedSchedule.data : s
                ));

                setSuccess(`Schedule "${form.name}" updated successfully!`);
                resetForm();

            } else {
                const newSchedule = await createSchedule(school.id, payload);

                setSchedules([...schedules, newSchedule]);
                setSuccess(`Schedule "${form.name}" created successfully!`);
                resetForm();
            }
        } catch (err) {
            console.error("Schedule save error:", err);
            setError(err.message || "Failed to save schedule. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async (scheduleId, scheduleName) => {
        if (!confirm(`Are you sure you want to delete "${scheduleName}"?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteSchedule(school.id, scheduleId);

            setSchedules(schedules.filter(s => s.id !== scheduleId));
            setSelectedIds(selectedIds.filter(id => id !== scheduleId));
            setSuccess(`Schedule "${scheduleName}" deleted successfully!`);

        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete schedule. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) {
            setError("No schedules selected!");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedIds.length} schedule(s)?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const deletePromises = selectedIds.map(id =>
                deleteSchedule(school.id, id)
            );

            await Promise.all(deletePromises);

            setSchedules(schedules.filter(s => !selectedIds.includes(s.id)));
            setSelectedIds([]);
            setSuccess(`${selectedIds.length} schedule(s) deleted successfully!`);

        } catch (err) {
            console.error("Bulk delete error:", err);
            setError("Failed to delete some schedules. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEdit = (schedule) => {
        setForm({
            name: schedule.name,
            is_active: schedule.is_active
        });
        setEditingSchedule(schedule);
        setIsModalOpen(true);
    };

    const handleManagePeriods = (scheduleId) => {
        navigate(`/school/schedules/${scheduleId}/periods`);
    };

    const filteredSchedules = schedules.filter(schedule =>
        schedule.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (schedule.is_active ? "active" : "inactive").includes(searchTerm.toLowerCase())
    );

    const getStartTime = (schedule) => {
        if (!schedule.periods || schedule.periods.length === 0) return "—";
        const firstPeriod = schedule.periods[0];
        return firstPeriod.start_time || "—";
    };

    const getEndTime = (schedule) => {
        if (!schedule.periods || schedule.periods.length === 0) return "—";
        const lastPeriod = schedule.periods[schedule.periods.length - 1];
        return lastPeriod.end_time || "—";
    };

    const countPeriods = (schedule) => {
        return schedule.periods?.length || 0;
    };

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Calendar className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage schedules.</p>
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
                <LoadingSpinner size="lg" text="Loading schedules..." />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                        <Calendar className="h-7 w-7 text-indigo-600" />
                        Schedules
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {school ? `Managing schedules for ${school.name}` : "Select a school first"}
                    </p>
                    {schedules.length > 0 && (
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                                <Calendar size={14} />
                                {schedules.length} schedule(s)
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock size={14} />
                                {schedules.filter(s => s.is_active).length} active
                            </span>
                        </div>
                    )}
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
                            setIsModalOpen(true);
                        }}
                        disabled={actionLoading}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg shadow-md font-medium transition disabled:opacity-50"
                    >
                        <Plus size={18} />
                        Create Schedule
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

            <div className="mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <input
                        type="text"
                        placeholder="Search schedules by name or status..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                    />
                </div>
            </div>

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {filteredSchedules.length === 0 ? (
                    <div className="text-center py-12">
                        <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            {searchTerm ? "No matching schedules found" : "No schedules yet"}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {searchTerm ? "Try a different search term" : "Create your first schedule to get started"}
                        </p>
                        {!searchTerm && (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                                Create First Schedule
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {selectedIds.length > 0 && (
                            <div className="bg-indigo-50 border-b border-indigo-200 px-6 py-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-indigo-700 font-medium">
                                        {selectedIds.length} schedule(s) selected
                                    </span>
                                    <button
                                        onClick={() => setSelectedIds([])}
                                        className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
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
                                                    e.target.checked ? filteredSchedules.map(s => s.id) : []
                                                )
                                            }
                                            checked={selectedIds.length === filteredSchedules.length && filteredSchedules.length > 0}
                                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            disabled={actionLoading}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-16">
                                        #
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Schedule Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Time Range
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Periods
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider text-right">
                                        Actions
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {filteredSchedules.map((schedule, index) => (
                                    <tr
                                        key={schedule.id}
                                        className={`hover:bg-gray-50 transition-colors ${
                                            selectedIds.includes(schedule.id) ? 'bg-indigo-50' : ''
                                        }`}
                                    >
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(schedule.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked)
                                                        setSelectedIds([...selectedIds, schedule.id]);
                                                    else
                                                        setSelectedIds(selectedIds.filter(id => id !== schedule.id));
                                                }}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                disabled={actionLoading}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {index + 1}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{schedule.name}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-gray-400" />
                                                <span className="text-sm text-gray-700">
                                                        {getStartTime(schedule)} - {getEndTime(schedule)}
                                                    </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-700">
                                                {countPeriods(schedule)} period(s)
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                                <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-full ${
                                                    schedule.is_active
                                                        ? 'bg-green-100 text-green-800 border border-green-200'
                                                        : 'bg-red-100 text-red-800 border border-red-200'
                                                }`}>
                                                    {schedule.is_active ? (
                                                        <>
                                                            <Check size={12} />
                                                            Active
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X size={12} />
                                                            Inactive
                                                        </>
                                                    )}
                                                </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleManagePeriods(schedule.id)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-blue-500 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Clock size={14} />
                                                    Periods
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(schedule)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Edit size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(schedule.id, schedule.name)}
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
                                    Showing {filteredSchedules.length} of {schedules.length} schedule(s)
                                    {searchTerm && ` matching "${searchTerm}"`}
                                </div>
                                {selectedIds.length > 0 && (
                                    <div className="text-sm font-medium text-indigo-700">
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
                                    {editingSchedule ? "Edit Schedule" : "Create Schedule"}
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
                                        Schedule Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Regular Schedule, Exam Schedule"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div className="pt-4 border-t border-gray-200">
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={form.is_active}
                                            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                                            className="h-5 w-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                            disabled={actionLoading}
                                        />
                                        <div>
                                            <span className="text-sm font-medium text-gray-700">Active Schedule</span>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Inactive schedules won't be available for timetable generation
                                            </p>
                                        </div>
                                    </label>
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
                                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {editingSchedule ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingSchedule ? "Update Schedule" : "Create Schedule"
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}