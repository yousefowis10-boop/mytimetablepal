import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { Calendar, Plus, Trash2, Edit, Search, AlertCircle, CheckCircle, XCircle, Clock, Grid } from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchTimetables,
    createTimetable,
    updateTimetable,
    deleteTimetable,
    fetchSchedules,
    generateTimetableEntries
} from "../services/api";

export default function Timetables() {
    const navigate = useNavigate();
    const { school } = useSchool();
    const [timetables, setTimetables] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form, setForm] = useState({
        name: "",
        description: "",
        effective_date_start: "",
        effective_date_end: "",
        schedule: "",
    });
    const [editingTimetable, setEditingTimetable] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const [generatingId, setGeneratingId] = useState(null);

    useEffect(() => {
        if (!school) {
            setLoading(false);
            return;
        }

        const loadData = async () => {
            try {
                setLoading(true);
                setError("");

                const [timetablesData, schedulesData] = await Promise.all([
                    fetchTimetables(school.id),
                    fetchSchedules(school.id)
                ]);

                const processedTimetables = (timetablesData || []).map(timetable => {
                    if (typeof timetable.schedule === 'number') {
                        const scheduleObj = (schedulesData || []).find(s => s.id === timetable.schedule);
                        return {
                            ...timetable,
                            schedule: scheduleObj || timetable.schedule
                        };
                    }
                    return timetable;
                });

                setTimetables(processedTimetables);
                setSchedules(schedulesData || []);
            } catch (err) {
                console.error("Failed to load data:", err);
                setError("Failed to load timetables. Please try again.");
            } finally {
                setLoading(false);
            }
        };
        loadData();
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
        setForm({
            name: "",
            description: "",
            effective_date_start: "",
            effective_date_end: "",
            schedule: "",
        });
        setEditingTimetable(null);
        setIsModalOpen(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!school) {
            setError("Please select or create a school first!");
            return;
        }

        if (!form.name.trim()) {
            setError("Timetable name is required");
            return;
        }

        if (!form.schedule) {
            setError("Please select a schedule");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim(),
                effective_date_start: form.effective_date_start,
                effective_date_end: form.effective_date_end,
                schedule: form.schedule,
            };

            if (editingTimetable) {
                const response = await updateTimetable(
                    school.id,
                    editingTimetable.id,
                    payload
                );

                console.log("Update response:", response);

                const updatedTimetableData = response.data || response;

                if (typeof updatedTimetableData.schedule === 'number') {
                    const scheduleObj = schedules.find(s => s.id === updatedTimetableData.schedule);
                    if (scheduleObj) {
                        updatedTimetableData.schedule = scheduleObj;
                    }
                }

                setTimetables(timetables.map(t =>
                    t.id === editingTimetable.id ? updatedTimetableData : t
                ));

                setSuccess(`Timetable "${form.name}" updated successfully!`);
                resetForm();

            } else {
                const response = await createTimetable(school.id, payload);

                console.log("Create response:", response);

                const newTimetableData = response.data || response;

                if (typeof newTimetableData.schedule === 'number') {
                    const scheduleObj = schedules.find(s => s.id === newTimetableData.schedule);
                    if (scheduleObj) {
                        newTimetableData.schedule = scheduleObj;
                    }
                }

                setTimetables([...timetables, newTimetableData]);
                setSuccess(`Timetable "${form.name}" created successfully!`);
                resetForm();
            }
        } catch (err) {
            console.error("Timetable save error:", err);
            setError(err.message || "Failed to save timetable. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async (timetableId, timetableName) => {
        if (!confirm(`Are you sure you want to delete "${timetableName}"?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteTimetable(school.id, timetableId);

            setTimetables(timetables.filter(t => t.id !== timetableId));
            setSelectedIds(selectedIds.filter(id => id !== timetableId));
            setSuccess(`Timetable "${timetableName}" deleted successfully!`);

        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete timetable. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) {
            setError("No timetables selected!");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedIds.length} timetable(s)?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const deletePromises = selectedIds.map(id =>
                deleteTimetable(school.id, id)
            );

            await Promise.all(deletePromises);

            setTimetables(timetables.filter(t => !selectedIds.includes(t.id)));
            setSelectedIds([]);
            setSuccess(`${selectedIds.length} timetable(s) deleted successfully!`);

        } catch (err) {
            console.error("Bulk delete error:", err);
            setError("Failed to delete some timetables. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleGenerate = async (timetableId, timetableName) => {
        if (!confirm(`Generate timetable entries for "${timetableName}"? This will create entries based on subject requirements.`)) return;

        setGeneratingId(timetableId);
        setError("");
        setSuccess("");

        try {
            const result = await generateTimetableEntries(school.id, timetableId);

            setSuccess(result.message || `Timetable "${timetableName}" generated successfully!`);
        } catch (err) {
            console.error("Generate error:", err);
            setError(err.message || "Failed to generate timetable. Please try again.");
        } finally {
            setGeneratingId(null);
        }
    };

    const handleEdit = (timetable) => {
        setForm({
            name: timetable.name,
            description: timetable.description || "",
            effective_date_start: timetable.effective_date_start,
            effective_date_end: timetable.effective_date_end,
            schedule: timetable.schedule?.id || timetable.schedule || "",
        });
        setEditingTimetable(timetable);
        setIsModalOpen(true);
    };

    const handleManageEntries = (timetableId) => {
        navigate(`/school/timetables/${timetableId}/visual`);
    };

    const getScheduleName = (schedule) => {
        if (!schedule) return "No schedule";

        if (typeof schedule === 'object' && schedule.name) {
            return schedule.name;
        }

        if (typeof schedule === 'number' || typeof schedule === 'string') {
            const foundSchedule = schedules.find(s => s.id == schedule);
            return foundSchedule ? foundSchedule.name : `Schedule ${schedule}`;
        }

        return "No schedule";
    };

    const filteredTimetables = timetables.filter(timetable => {
        const scheduleName = getScheduleName(timetable.schedule);
        return (
            timetable.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            timetable.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            scheduleName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    });

    const formatDate = (dateString) => {
        if (!dateString) return "";
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const isTimetableActive = (timetable) => {
        if (!timetable.effective_date_start || !timetable.effective_date_end) return false;
        const today = new Date();
        const startDate = new Date(timetable.effective_date_start);
        const endDate = new Date(timetable.effective_date_end);
        return today >= startDate && today <= endDate;
    };

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Calendar className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage timetables.</p>
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
                <LoadingSpinner size="lg" text="Loading timetables..." />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                        <Calendar className="h-7 w-7 text-indigo-600" />
                        Timetables
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {school ? `Managing timetables for ${school.name}` : "Select a school first"}
                    </p>
                    {timetables.length > 0 && (
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                                <Calendar size={14} />
                                {timetables.length} timetable(s)
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock size={14} />
                                {timetables.filter(t => isTimetableActive(t)).length} active
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
                        Create Timetable
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
                        placeholder="Search timetables by name, description, or schedule..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                    />
                </div>
            </div>

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {filteredTimetables.length === 0 ? (
                    <div className="text-center py-12">
                        <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            {searchTerm ? "No matching timetables found" : "No timetables yet"}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {searchTerm ? "Try a different search term" : "Create your first timetable to get started"}
                        </p>
                        {!searchTerm && (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                                Create First Timetable
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {selectedIds.length > 0 && (
                            <div className="bg-indigo-50 border-b border-indigo-200 px-6 py-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-indigo-700 font-medium">
                                        {selectedIds.length} timetable(s) selected
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
                                                    e.target.checked ? filteredTimetables.map(t => t.id) : []
                                                )
                                            }
                                            checked={selectedIds.length === filteredTimetables.length && filteredTimetables.length > 0}
                                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            disabled={actionLoading}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-16">
                                        #
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Timetable Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Schedule
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Active Period
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
                                {filteredTimetables.map((timetable, index) => {
                                    const isActive = isTimetableActive(timetable);

                                    return (
                                        <tr
                                            key={timetable.id}
                                            className={`hover:bg-gray-50 transition-colors ${
                                                selectedIds.includes(timetable.id) ? 'bg-indigo-50' : ''
                                            }`}
                                        >
                                            <td className="px-6 py-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.includes(timetable.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked)
                                                            setSelectedIds([...selectedIds, timetable.id]);
                                                        else
                                                            setSelectedIds(selectedIds.filter(id => id !== timetable.id));
                                                    }}
                                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                    disabled={actionLoading}
                                                />
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {index + 1}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <div className="text-sm font-medium text-gray-900">{timetable.name}</div>
                                                    {timetable.description && (
                                                        <div className="text-xs text-gray-500 mt-1 truncate max-w-xs">
                                                            {timetable.description}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-gray-700">
                                                    {getScheduleName(timetable.schedule)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-gray-700">
                                                    {formatDate(timetable.effective_date_start)} - {formatDate(timetable.effective_date_end)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-full ${
                                                        isActive
                                                            ? 'bg-green-100 text-green-800 border border-green-200'
                                                            : 'bg-gray-100 text-gray-800 border border-gray-200'
                                                    }`}>
                                                        {isActive ? "Active" : "Inactive"}
                                                    </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => handleGenerate(timetable.id, timetable.name)}
                                                        disabled={actionLoading || generatingId === timetable.id}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 border border-green-500 text-green-700 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
                                                    >
                                                        {generatingId === timetable.id ? (
                                                            <LoadingSpinner size="sm" color="green" />
                                                        ) : (
                                                            <Plus size={14} />
                                                        )}
                                                        Generate
                                                    </button>
                                                    <button
                                                        onClick={() => handleManageEntries(timetable.id)}
                                                        disabled={actionLoading}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 border border-blue-500 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                                                    >
                                                        <Grid size={14} />
                                                        Manage
                                                    </button>
                                                    <button
                                                        onClick={() => handleEdit(timetable)}
                                                        disabled={actionLoading}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                    >
                                                        <Edit size={14} />
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(timetable.id, timetable.name)}
                                                        disabled={actionLoading}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 border border-red-400 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                                                    >
                                                        <Trash2 size={14} />
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>

                        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                            <div className="flex items-center justify-between">
                                <div className="text-sm text-gray-600">
                                    Showing {filteredTimetables.length} of {timetables.length} timetable(s)
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
                                    {editingTimetable ? "Edit Timetable" : "Create Timetable"}
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
                                        Timetable Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Fall 2024 Schedule, Exam Timetable"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Description
                                    </label>
                                    <textarea
                                        placeholder="Optional description for this timetable..."
                                        value={form.description}
                                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                                        rows="3"
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition disabled:opacity-50"
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Start Date *
                                        </label>
                                        <input
                                            type="date"
                                            value={form.effective_date_start}
                                            onChange={(e) => setForm({ ...form, effective_date_start: e.target.value })}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition disabled:opacity-50"
                                            required
                                            disabled={actionLoading}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            End Date *
                                        </label>
                                        <input
                                            type="date"
                                            value={form.effective_date_end}
                                            onChange={(e) => setForm({ ...form, effective_date_end: e.target.value })}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition disabled:opacity-50"
                                            required
                                            disabled={actionLoading}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Schedule *
                                    </label>
                                    <select
                                        value={form.schedule}
                                        onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    >
                                        <option value="">Select a schedule</option>
                                        {schedules.map((schedule) => (
                                            <option key={schedule.id} value={schedule.id}>
                                                {schedule.name} {schedule.is_active ? "" : "(Inactive)"}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Choose the daily schedule pattern for this timetable
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
                                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {editingTimetable ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingTimetable ? "Update Timetable" : "Create Timetable"
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