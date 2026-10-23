import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { Users, Plus, Trash2, Edit, Search, Building, AlertCircle, CheckCircle, XCircle, BookOpen } from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchStudentGroups,
    createStudentGroup,
    updateStudentGroup,
    deleteStudentGroup,
    fetchClassrooms
} from "../services/api";

export default function StudentGroups() {
    const navigate = useNavigate();
    const { school } = useSchool();
    const [groups, setGroups] = useState([]);
    const [classrooms, setClassrooms] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [form, setForm] = useState({
        name: "",
        description: "",
        classroom: ""
    });
    const [editingGroup, setEditingGroup] = useState(null);
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

                const [groupsData, classroomsData] = await Promise.all([
                    fetchStudentGroups(school.id),
                    fetchClassrooms(school.id)
                ]);

                setGroups(groupsData || []);
                setClassrooms(classroomsData || []);
            } catch (err) {
                console.error("Failed to load data:", err);
                setError("Failed to load data. Please try again.");
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
        setForm({ name: "", description: "", classroom: "" });
        setEditingGroup(null);
        setIsModalOpen(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!school) {
            setError("Please select or create a school first!");
            return;
        }

        if (!form.name.trim()) {
            setError("Group name is required");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim(),
                classroom_id: form.classroom === "" ? null : parseInt(form.classroom), // Change this!
                school: school.id
            };

            console.log("Sending payload:", payload);

            if (editingGroup) {
                const updatedGroup = await updateStudentGroup(
                    school.id,
                    editingGroup.id,
                    payload
                );

                const groupData = updatedGroup.data || updatedGroup;

                setGroups(groups.map(g =>
                    g.id === editingGroup.id ? groupData : g
                ));

                setSuccess(`Group "${form.name}" updated successfully!`);
                resetForm();

            } else {
                const newGroup = await createStudentGroup(school.id, payload);

                const groupData = newGroup.data || newGroup;

                setGroups([...groups, groupData]);
                setSuccess(`Group "${form.name}" created successfully!`);
                resetForm();
            }
        } catch (err) {
            console.error("Group save error:", err);

            if (err.response?.data) {
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
                } else {
                    setError(err.response.data);
                }
            } else if (err.message) {
                setError(err.message);
            } else {
                setError("Failed to save group. Please try again.");
            }
        } finally {
            setActionLoading(false);
        }
    };
    const handleDelete = async (groupId, groupName) => {
        if (!confirm(`Are you sure you want to delete "${groupName}"?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteStudentGroup(school.id, groupId);

            setGroups(groups.filter(g => g.id !== groupId));
            setSelectedIds(selectedIds.filter(id => id !== groupId));
            setSuccess(`Group "${groupName}" deleted successfully!`);

        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete group. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) {
            setError("No groups selected!");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedIds.length} group(s)?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const deletePromises = selectedIds.map(id =>
                deleteStudentGroup(school.id, id)
            );

            await Promise.all(deletePromises);

            setGroups(groups.filter(g => !selectedIds.includes(g.id)));
            setSelectedIds([]);
            setSuccess(`${selectedIds.length} group(s) deleted successfully!`);

        } catch (err) {
            console.error("Bulk delete error:", err);
            setError("Failed to delete some groups. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEdit = (group) => {
        setForm({
            name: group.name,
            description: group.description || "",
            classroom: group.classroom?.id || ""
        });
        setEditingGroup(group);
        setIsModalOpen(true);
    };

    const handleManageRequirements = (groupId) => {
        navigate(`/school/groups/${groupId}/subject-requirement`);
    };

    const filteredGroups = groups.filter(group =>
        group.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.classroom?.name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Users className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage student groups.</p>
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
                <LoadingSpinner size="lg" text="Loading student groups..." />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                        <Users className="h-7 w-7 text-green-600" />
                        Student Groups
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {school ? `Managing groups for ${school.name}` : "Select a school first"}
                    </p>
                    {groups.length > 0 && (
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                                <Users size={14} />
                                {groups.length} group(s)
                            </span>
                            <span className="flex items-center gap-1">
                                <Building size={14} />
                                {classrooms.length} classroom(s) available
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
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-lg shadow-md font-medium transition disabled:opacity-50"
                    >
                        <Plus size={18} />
                        Create Group
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
                        placeholder="Search groups by name, description, or classroom..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                    />
                </div>
            </div>

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {filteredGroups.length === 0 ? (
                    <div className="text-center py-12">
                        <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            {searchTerm ? "No matching groups found" : "No student groups yet"}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {searchTerm ? "Try a different search term" : "Create your first student group to get started"}
                        </p>
                        {!searchTerm && (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                                Create First Group
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {selectedIds.length > 0 && (
                            <div className="bg-green-50 border-b border-green-200 px-6 py-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-green-700 font-medium">
                                        {selectedIds.length} group(s) selected
                                    </span>
                                    <button
                                        onClick={() => setSelectedIds([])}
                                        className="text-sm text-green-600 hover:text-green-800 hover:underline"
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
                                                    e.target.checked ? filteredGroups.map(g => g.id) : []
                                                )
                                            }
                                            checked={selectedIds.length === filteredGroups.length && filteredGroups.length > 0}
                                            className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                                            disabled={actionLoading}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-16">
                                        #
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Group Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Description
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Classroom
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider text-right">
                                        Actions
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {filteredGroups.map((group, index) => (
                                    <tr
                                        key={group.id}
                                        className={`hover:bg-gray-50 transition-colors ${
                                            selectedIds.includes(group.id) ? 'bg-green-50' : ''
                                        }`}
                                    >
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(group.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked)
                                                        setSelectedIds([...selectedIds, group.id]);
                                                    else
                                                        setSelectedIds(selectedIds.filter(id => id !== group.id));
                                                }}
                                                className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                                                disabled={actionLoading}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {index + 1}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{group.name}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-700 max-w-xs truncate">
                                                {group.description || "—"}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Building className="h-4 w-4 text-gray-400" />
                                                <span className="text-sm text-gray-900">
                                                        {group.classroom?.name || "No classroom"}
                                                    </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleManageRequirements(group.id)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-blue-500 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                                                >
                                                    <BookOpen size={14} />
                                                    Subjects
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(group)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Edit size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(group.id, group.name)}
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
                                    Showing {filteredGroups.length} of {groups.length} group(s)
                                    {searchTerm && ` matching "${searchTerm}"`}
                                </div>
                                {selectedIds.length > 0 && (
                                    <div className="text-sm font-medium text-green-700">
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
                                    {editingGroup ? "Edit Student Group" : "Create Student Group"}
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
                                        Group Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Grade 10-A, Computer Science Batch"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Description
                                    </label>
                                    <textarea
                                        placeholder="Optional description about this student group..."
                                        value={form.description}
                                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                                        rows="3"
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition disabled:opacity-50"
                                        disabled={actionLoading}
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Optional: Add a brief description for this student group
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Assigned Classroom
                                    </label>
                                    <select
                                        value={form.classroom}
                                        onChange={(e) => setForm({ ...form, classroom: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition disabled:opacity-50"
                                        disabled={actionLoading}
                                    >
                                        <option value="">Select a classroom (optional)</option>
                                        {classrooms.map((classroom) => (
                                            <option key={classroom.id} value={classroom.id}>
                                                {classroom.name} (Capacity: {classroom.capacity})
                                            </option>
                                        ))}

                                    </select>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Optional: Assign a primary classroom for this group
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
                                        className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {editingGroup ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingGroup ? "Update Group" : "Create Group"
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