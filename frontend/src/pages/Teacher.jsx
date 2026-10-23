import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { User, Plus, Trash2, Edit, Search, Users, AlertCircle, CheckCircle, XCircle, Calendar } from "lucide-react";
import Select from "react-select";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchTeachers,
    createTeacher,
    updateTeacher,
    deleteTeacher,
    fetchSubjects
} from "../services/api";

export default function Teacher() {
    const navigate = useNavigate();
    const { school } = useSchool();
    const [teachers, setTeachers] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [form, setForm] = useState({
        name: "",
        subjects: [],
        experience: "1",
    });
    const [editingTeacher, setEditingTeacher] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);

    useEffect(() => {
        if (!school) {
            setLoading(false);
            return;
        }

        const loadData = async () => {
            try {
                setLoading(true);
                setError("");

                const [teachersData, subjectsData] = await Promise.all([
                    fetchTeachers(school.id),
                    fetchSubjects(school.id)
                ]);

                setTeachers(teachersData || []);
                setSubjects(subjectsData || []);
            } catch (err) {
                console.error("Failed to load data:", err);
                setError(err.message || "Failed to load data. Please try again.");
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
        setForm({ name: "", subjects: [], experience: "1" });
        setEditingTeacher(null);
        setIsModalOpen(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!school) {
            setError("Please select or create a school first!");
            return;
        }

        if (form.subjects.length === 0) {
            setError("Please select at least one subject");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const payload = {
                name: form.name,
                subjects: form.subjects,
                experience: parseInt(form.experience) || 1,
                school: school.id,
            };

            if (editingTeacher) {
                const updatedTeacher = await updateTeacher(
                    editingTeacher.id,
                    payload
                );

                setTeachers(teachers.map(t =>
                    t.id === editingTeacher.id ? updatedTeacher.data : t
                ));

                setSuccess(`Teacher "${form.name}" updated successfully!`);
                resetForm();

            } else {
                const newTeacher = await createTeacher(school.id, payload);

                setTeachers([...teachers, newTeacher]);
                setSuccess(`Teacher "${form.name}" created successfully!`);
                resetForm();
            }
        } catch (err) {
            console.error("Teacher save error:", err);
            setError(err.message || "Failed to save teacher. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async (teacherId, teacherName) => {
        if (!confirm(`Are you sure you want to delete "${teacherName}"?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteTeacher(teacherId);

            setTeachers(teachers.filter(t => t.id !== teacherId));
            setSelectedIds(selectedIds.filter(id => id !== teacherId));
            setSuccess(`Teacher "${teacherName}" deleted successfully!`);

        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete teacher. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) {
            setError("No teachers selected!");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedIds.length} teacher(s)?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const deletePromises = selectedIds.map(id =>
                deleteTeacher(id)
            );

            await Promise.all(deletePromises);

            setTeachers(teachers.filter(t => !selectedIds.includes(t.id)));
            setSelectedIds([]);
            setSuccess(`${selectedIds.length} teacher(s) deleted successfully!`);

        } catch (err) {
            console.error("Bulk delete error:", err);
            setError("Failed to delete some teachers. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEdit = (teacher) => {
        setForm({
            name: teacher.name,
            subjects: teacher.subjects ? teacher.subjects.map(s => s.id) : [],
            experience: teacher.experience?.toString() || "1",
        });
        setEditingTeacher(teacher);
        setIsModalOpen(true);
    };

    const handleManageAvailability = (teacherId) => {
        navigate(`/school/teachers/${teacherId}/availability`);
    };

    const filteredTeachers = teachers.filter(teacher =>
        teacher.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (teacher.subject_names || []).join(", ").toLowerCase().includes(searchTerm.toLowerCase())
    );

    const subjectOptions = subjects.map(subject => ({
        value: subject.id,
        label: subject.name
    }));

    const selectedSubjectValues = subjectOptions.filter(option =>
        form.subjects.includes(option.value)
    );

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <User className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage teachers.</p>
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
                <LoadingSpinner size="lg" text="Loading teachers..." />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                        <User className="h-7 w-7 text-indigo-600" />
                        Teachers
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {school ? `Managing teachers for ${school.name}` : "Select a school first"}
                    </p>
                    {teachers.length > 0 && (
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                                <User size={14} />
                                {teachers.length} teacher(s)
                            </span>
                            <span className="flex items-center gap-1">
                                <Users size={14} />
                                {subjects.length} subject(s) available
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
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg shadow-md font-medium transition disabled:opacity-50"
                    >
                        <Plus size={18} />
                        Create Teacher
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
                        placeholder="Search teachers by name or subjects..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    />
                </div>
            </div>

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {filteredTeachers.length === 0 ? (
                    <div className="text-center py-12">
                        <User className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            {searchTerm ? "No matching teachers found" : "No teachers yet"}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {searchTerm ? "Try a different search term" : "Create your first teacher to get started"}
                        </p>
                        {!searchTerm && (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Create First Teacher
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {selectedIds.length > 0 && (
                            <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-blue-700 font-medium">
                                        {selectedIds.length} teacher(s) selected
                                    </span>
                                    <button
                                        onClick={() => setSelectedIds([])}
                                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
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
                                                    e.target.checked ? filteredTeachers.map(t => t.id) : []
                                                )
                                            }
                                            checked={selectedIds.length === filteredTeachers.length && filteredTeachers.length > 0}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            disabled={actionLoading}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-16">
                                        #
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Teacher Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Subjects
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Experience
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider text-right">
                                        Actions
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {filteredTeachers.map((teacher, index) => (
                                    <tr
                                        key={teacher.id}
                                        className={`hover:bg-gray-50 transition-colors ${
                                            selectedIds.includes(teacher.id) ? 'bg-blue-50' : ''
                                        }`}
                                    >
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(teacher.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked)
                                                        setSelectedIds([...selectedIds, teacher.id]);
                                                    else
                                                        setSelectedIds(selectedIds.filter(id => id !== teacher.id));
                                                }}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                disabled={actionLoading}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {index + 1}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-700 max-w-xs">
                                                {(teacher.subject_names || []).join(", ") || "—"}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-900">
                                                {teacher.experience} year(s)
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleManageAvailability(teacher.id)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-green-500 text-green-700 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Calendar size={14} />
                                                    Availability
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(teacher)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Edit size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(teacher.id, teacher.name)}
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
                                    Showing {filteredTeachers.length} of {teachers.length} teacher(s)
                                    {searchTerm && ` matching "${searchTerm}"`}
                                </div>
                                {selectedIds.length > 0 && (
                                    <div className="text-sm font-medium text-blue-700">
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
                                    {editingTeacher ? "Edit Teacher" : "Create Teacher"}
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
                                        Teacher Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., John Smith"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Subjects *
                                    </label>
                                    <Select
                                        isMulti
                                        options={subjectOptions}
                                        value={selectedSubjectValues}
                                        onChange={(selectedOptions) =>
                                            setForm({
                                                ...form,
                                                subjects: selectedOptions.map(opt => opt.value)
                                            })
                                        }
                                        className="basic-multi-select"
                                        classNamePrefix="select"
                                        placeholder="Select subjects..."
                                        isDisabled={actionLoading || subjects.length === 0}
                                        styles={{
                                            control: (base) => ({
                                                ...base,
                                                borderColor: '#d1d5db',
                                                '&:hover': { borderColor: '#3b82f6' },
                                                minHeight: '48px',
                                                padding: '2px 0'
                                            }),
                                            placeholder: (base) => ({
                                                ...base,
                                                color: '#9ca3af'
                                            })
                                        }}
                                    />
                                    {subjects.length === 0 && (
                                        <p className="mt-2 text-sm text-amber-600">
                                            No subjects found. Please create subjects first.
                                        </p>
                                    )}
                                    <p className="mt-1 text-xs text-gray-500">
                                        Select one or more subjects this teacher can teach
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Experience (Years)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="50"
                                        placeholder="e.g., 5"
                                        value={form.experience}
                                        onChange={(e) => setForm({ ...form, experience: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        disabled={actionLoading}
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Years of teaching experience
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
                                        disabled={actionLoading || form.subjects.length === 0}
                                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {editingTeacher ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingTeacher ? "Update Teacher" : "Create Teacher"
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