import { useState, useEffect, useContext } from "react";
import { SchoolContext } from "../context/SchoolContext";
import { useNavigate } from "react-router-dom";
import { Book, Plus, Trash2, Edit, AlertCircle, CheckCircle, XCircle, Search } from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchSubjects,
    createSubject,
    updateSubject,
    deleteSubject
} from "../services/api";

export default function Subject() {
    const navigate = useNavigate();
    const [subjects, setSubjects] = useState([]);
    const [selectedSubjects, setSelectedSubjects] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [form, setForm] = useState({
        id: null,
        name: "",
        code: "",
        description: ""
    });
    const [editingId, setEditingId] = useState(null);

    const { school } = useContext(SchoolContext);
    const schoolId = school?.id;

    useEffect(() => {
        if (!schoolId) {
            setLoading(false);
            return;
        }

        const loadSubjects = async () => {
            try {
                setLoading(true);
                setError("");
                const subjectsData = await fetchSubjects(schoolId);
                setSubjects(subjectsData || []);
            } catch (err) {
                console.error("Failed to load subjects:", err);
                setError("Failed to load subjects. Please try again.");
            } finally {
                setLoading(false);
            }
        };

        loadSubjects();
    }, [schoolId]);

    useEffect(() => {
        if (error || success) {
            const timer = setTimeout(() => {
                setError("");
                setSuccess("");
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [error, success]);

    useEffect(() => {
        if (!school) {
            setError("Please select or create a school first!");
            setTimeout(() => {
                navigate("/school");
            }, 2000);
        }
    }, [school, navigate]);

    const handleDelete = async (id, subjectName) => {
        if (!confirm(`Are you sure you want to delete "${subjectName}"?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteSubject(schoolId, id);
            setSubjects(subjects.filter((s) => s.id !== id));
            setSelectedSubjects(selectedSubjects.filter(sid => sid !== id));
            setSuccess(`Subject "${subjectName}" deleted successfully!`);
        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete subject. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedSubjects.length === 0) {
            setError("No subjects selected!");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedSubjects.length} subject(s)?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const deletePromises = selectedSubjects.map(id =>
                deleteSubject(schoolId, id)
            );

            await Promise.all(deletePromises);

            setSubjects(subjects.filter((s) => !selectedSubjects.includes(s.id)));
            setSelectedSubjects([]);
            setSuccess(`${selectedSubjects.length} subject(s) deleted successfully!`);

        } catch (err) {
            console.error("Bulk delete error:", err);
            setError("Failed to delete some subjects. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEdit = (subject) => {
        setForm({
            id: subject.id,
            name: subject.name || "",
            code: subject.code || "",
            description: subject.description || ""
        });
        setEditingId(subject.id);
        setIsModalOpen(true);
    };


    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!schoolId) {
            setError("Please select or create a school first!");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const subjectData = {
                name: form.name.trim(),
                code: form.code.trim(),
                description: form.description.trim(),
                school: schoolId
            };

            if (editingId) {
                const updatedSubject = await updateSubject(schoolId, editingId, subjectData);

                setSubjects(subjects.map((s) =>
                    s.id === editingId ? updatedSubject : s
                ));

                setSuccess(`Subject "${form.name}" updated successfully!`);
            } else {
                const newSubject = await createSubject(schoolId, subjectData);

                setSubjects([...subjects, newSubject]);
                setSuccess(`Subject "${form.name}" created successfully!`);
            }

            resetForm();

        } catch (err) {
            console.error("Subject save error:", err);

            if (err.response && err.response.data) {
                if (typeof err.response.data === 'object') {
                    const errorMessages = [];
                    Object.entries(err.response.data).forEach(([field, messages]) => {
                        if (Array.isArray(messages)) {
                            errorMessages.push(`${field}: ${messages.join(', ')}`);
                        } else {
                            errorMessages.push(`${field}: ${messages}`);
                        }
                    });
                    setError(errorMessages.join('; '));
                } else if (typeof err.response.data === 'string') {
                    setError(err.response.data);
                } else {
                    setError(err.message || "Failed to save subject. Please try again.");
                }
            } else if (err.message) {
                setError(err.message);
            } else {
                setError("Failed to save subject. Please try again.");
            }
        } finally {
            setActionLoading(false);
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setForm({ id: null, name: "", code: "", description: "" });
        setIsModalOpen(false);
    };

    const toggleSelectSubject = (id) => {
        setSelectedSubjects(prev =>
            prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
        );
    };

    const toggleSelectAll = () => {
        if (selectedSubjects.length === subjects.length && subjects.length > 0) {
            setSelectedSubjects([]);
        } else {
            setSelectedSubjects(subjects.map(s => s.id));
        }
    };

    const filteredSubjects = subjects.filter(subject =>
        subject.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        subject.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        subject.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const truncateDescription = (desc, maxWords = 10) => {
        if (!desc) return "—";
        const words = desc.trim().split(/\s+/);
        return words.length > maxWords ? words.slice(0, maxWords).join(" ") + "..." : desc;
    };

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Book className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage subjects.</p>
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
                <LoadingSpinner size="lg" text="Loading subjects..." />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                        <Book className="h-7 w-7 text-indigo-600" />
                        Subjects
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {school ? `Managing subjects for ${school.name}` : "Select a school first"}
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    {selectedSubjects.length > 0 && (
                        <button
                            onClick={handleBulkDelete}
                            disabled={actionLoading}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg shadow font-medium transition disabled:opacity-50"
                        >
                            <Trash2 size={18} />
                            Delete Selected ({selectedSubjects.length})
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
                        Create Subject
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
                        placeholder="Search subjects by name, code, or description..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    />
                </div>
            </div>

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {filteredSubjects.length === 0 ? (
                    <div className="text-center py-12">
                        <Book className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            {searchTerm ? "No matching subjects found" : "No subjects yet"}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {searchTerm ? "Try a different search term" : "Create your first subject to get started"}
                        </p>
                        {!searchTerm && (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Create First Subject
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {selectedSubjects.length > 0 && (
                            <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
                                <div className="flex items-center justify-between">
                  <span className="text-blue-700 font-medium">
                    {selectedSubjects.length} subject(s) selected
                  </span>
                                    <button
                                        onClick={() => setSelectedSubjects([])}
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
                                            onChange={toggleSelectAll}
                                            checked={selectedSubjects.length === subjects.length && subjects.length > 0}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            disabled={actionLoading}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-16">
                                        #
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Subject Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Code
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Description
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider text-right">
                                        Actions
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {filteredSubjects.map((subject, index) => (
                                    <tr
                                        key={subject.id}
                                        className={`hover:bg-gray-50 transition-colors ${
                                            selectedSubjects.includes(subject.id) ? 'bg-blue-50' : ''
                                        }`}
                                    >
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedSubjects.includes(subject.id)}
                                                onChange={() => toggleSelectSubject(subject.id)}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                disabled={actionLoading}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {index + 1}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{subject.name}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {subject.code}
                        </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-600 max-w-xs">
                                                {truncateDescription(subject.description)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleEdit(subject)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Edit size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(subject.id, subject.name)}
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
                                    Showing {filteredSubjects.length} of {subjects.length} subject(s)
                                    {searchTerm && ` matching "${searchTerm}"`}
                                </div>
                                {selectedSubjects.length > 0 && (
                                    <div className="text-sm font-medium text-blue-700">
                                        {selectedSubjects.length} selected
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
                                    {editingId ? "Edit Subject" : "Create New Subject"}
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
                                        Subject Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Mathematics"
                                        value={form.name}
                                        onChange={(e) => {
                                            const name = e.target.value;
                                            setForm({
                                                ...form,
                                                name,
                                                code: name
                                                    .trim()
                                                    .toUpperCase()
                                                    .replace(/\s+/g, "_")
                                                    .replace(/[^A-Z0-9_]/g, "")
                                                    .slice(0, 20) // Limit code length
                                            });
                                        }}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Subject Code (Auto-generated)
                                    </label>
                                    <div className="p-3 bg-gray-50 border border-gray-300 rounded-lg">
                                        <code className="text-sm font-mono text-gray-700">{form.code || "Will be generated from name"}</code>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Code is automatically generated from the subject name
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Description
                                    </label>
                                    <textarea
                                        placeholder="Optional description about the subject..."
                                        value={form.description}
                                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none disabled:opacity-50"
                                        rows={3}
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div className="flex justify-end gap-3 pt-4">
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
                                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {editingId ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingId ? "Update Subject" : "Create Subject"
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