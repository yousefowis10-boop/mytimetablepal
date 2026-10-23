import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { Building, Plus, Trash2, Edit, Search, Home, Users, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchClassrooms,
    createClassroom,
    updateClassroom,
    deleteClassroom
} from "../services/api";

export default function Classroom() {
    const navigate = useNavigate();
    const { school } = useSchool();
    const [classrooms, setClassrooms] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [form, setForm] = useState({
        name: "",
        capacity: "",
        bulk: false,
        count: 1
    });
    const [editingClassroom, setEditingClassroom] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);

    useEffect(() => {
        if (!school) {
            setLoading(false);
            return;
        }

        const loadClassrooms = async () => {
            try {
                setLoading(true);
                setError("");
                const classroomsData = await fetchClassrooms(school.id);
                setClassrooms(classroomsData || []);
            } catch (err) {
                console.error("Failed to load classrooms:", err);
                setError("Failed to load classrooms. Please try again.");
            } finally {
                setLoading(false);
            }
        };

        loadClassrooms();
    }, [school]);

    // Check if user has selected a school
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
        setForm({ name: "", capacity: "", bulk: false, count: 1 });
        setEditingClassroom(null);
        setIsModalOpen(false);
    };


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!school) {
            setError("Please select or create a school first!");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            if (editingClassroom) {
                // Update single classroom using service
                const classroomData = {
                    name: form.name.trim(),
                    capacity: parseInt(form.capacity),
                    school: school.id  // Make sure to include school ID
                };

                const updatedClassroom = await updateClassroom(
                    school.id,
                    editingClassroom.id,
                    classroomData
                );

                setClassrooms(classrooms.map(cls =>
                    cls.id === editingClassroom.id ? updatedClassroom : cls
                ));

                setSuccess(`Classroom "${form.name}" updated successfully!`);
                resetForm();

            } else if (form.bulk) {
                const createdClassrooms = [];
                const errors = [];

                for (let i = 1; i <= form.count; i++) {
                    try {
                        const classroomName = `${form.name.trim()}-${i}`;
                        const classroomData = {
                            name: classroomName,
                            capacity: parseInt(form.capacity),
                            school: school.id
                        };

                        const newClassroom = await createClassroom(school.id, classroomData);
                        createdClassrooms.push(newClassroom);
                    } catch (err) {
                        console.error(`Error creating classroom ${i}:`, err);
                        const errorMsg = err.response?.data
                            ? JSON.stringify(err.response.data)
                            : err.message || "Unknown error";
                        errors.push(`Classroom ${i}: ${errorMsg}`);
                    }
                }

                setClassrooms([...classrooms, ...createdClassrooms]);

                if (errors.length > 0) {
                    setError(`Created ${createdClassrooms.length} classrooms. Errors: ${errors.join(', ')}`);
                } else {
                    setSuccess(`Successfully created ${createdClassrooms.length} classrooms!`);
                }

                resetForm();

            } else {
                const classroomData = {
                    name: form.name.trim(),
                    capacity: parseInt(form.capacity),
                    school: school.id
                };

                const newClassroom = await createClassroom(school.id, classroomData);

                setClassrooms([...classrooms, newClassroom]);
                setSuccess(`Classroom "${form.name}" created successfully!`);
                resetForm();
            }
        } catch (err) {
            console.error("Classroom save error:", err);

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
            } else {
                setError(err.message || "Failed to save classroom. Please try again.");
            }
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async (classroomId, classroomName) => {
        if (!confirm(`Are you sure you want to delete "${classroomName}"?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteClassroom(school.id, classroomId);

            setClassrooms(classrooms.filter(cls => cls.id !== classroomId));
            setSelectedIds(selectedIds.filter(id => id !== classroomId));
            setSuccess(`Classroom "${classroomName}" deleted successfully!`);

        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete classroom. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) {
            setError("No classrooms selected!");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedIds.length} classroom(s)?`)) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            const deletePromises = selectedIds.map(id =>
                deleteClassroom(school.id, id)
            );

            await Promise.all(deletePromises);

            setClassrooms(classrooms.filter(cls => !selectedIds.includes(cls.id)));
            setSelectedIds([]);
            setSuccess(`${selectedIds.length} classroom(s) deleted successfully!`);

        } catch (err) {
            console.error("Bulk delete error:", err);
            setError("Failed to delete some classrooms. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEdit = (cls) => {
        setForm({
            name: cls.name,
            capacity: cls.capacity,
            bulk: false,
            count: 1
        });
        setEditingClassroom(cls);
        setIsModalOpen(true);
    };

    const filteredClassrooms = classrooms.filter(classroom =>
        classroom.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        classroom.capacity?.toString().includes(searchTerm)
    );

    const totalCapacity = classrooms.reduce((sum, cls) => sum + (parseInt(cls.capacity) || 0), 0);

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Building className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage classrooms.</p>
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
                <LoadingSpinner size="lg" text="Loading classrooms..." />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                        <Building className="h-7 w-7 text-indigo-600" />
                        Classrooms
                    </h1>
                    <p className="text-gray-600 mt-1">
                        {school ? `Managing classrooms for ${school.name}` : "Select a school first"}
                    </p>
                    {classrooms.length > 0 && (
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Building size={14} />
                  {classrooms.length} classroom(s)
              </span>
                            <span className="flex items-center gap-1">
                <Users size={14} />
                                {totalCapacity} total capacity
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
                        Create Classroom
                    </button>
                </div>
            </div>

            {/* Messages */}
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
                        placeholder="Search classrooms by name or capacity..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    />
                </div>
            </div>

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {filteredClassrooms.length === 0 ? (
                    <div className="text-center py-12">
                        <Building className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            {searchTerm ? "No matching classrooms found" : "No classrooms yet"}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {searchTerm ? "Try a different search term" : "Create your first classroom to get started"}
                        </p>
                        {!searchTerm && (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Create First Classroom
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {selectedIds.length > 0 && (
                            <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
                                <div className="flex items-center justify-between">
                  <span className="text-blue-700 font-medium">
                    {selectedIds.length} classroom(s) selected
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
                                                    e.target.checked ? filteredClassrooms.map(c => c.id) : []
                                                )
                                            }
                                            checked={selectedIds.length === filteredClassrooms.length && filteredClassrooms.length > 0}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            disabled={actionLoading}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-16">
                                        #
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Classroom Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Capacity
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider text-right">
                                        Actions
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {filteredClassrooms.map((cls, index) => (
                                    <tr
                                        key={cls.id}
                                        className={`hover:bg-gray-50 transition-colors ${
                                            selectedIds.includes(cls.id) ? 'bg-blue-50' : ''
                                        }`}
                                    >
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(cls.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked)
                                                        setSelectedIds([...selectedIds, cls.id]);
                                                    else
                                                        setSelectedIds(selectedIds.filter(id => id !== cls.id));
                                                }}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                disabled={actionLoading}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {index + 1}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{cls.name}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Users className="h-4 w-4 text-gray-400" />
                                                <span className="text-sm text-gray-900 font-medium">{cls.capacity}</span>
                                                <span className="text-xs text-gray-500">students</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleEdit(cls)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Edit size={14} />
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(cls.id, cls.name)}
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
                                    Showing {filteredClassrooms.length} of {classrooms.length} classroom(s)
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
                                    {editingClassroom ? "Edit Classroom" : "Create Classroom(s)"}
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
                                        Classroom Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Room 101 or Science Lab"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Capacity (Students) *
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="200"
                                        placeholder="e.g., 30"
                                        value={form.capacity}
                                        onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Maximum number of students this classroom can accommodate
                                    </p>
                                </div>

                                {!editingClassroom && (
                                    <div className="pt-4 border-t border-gray-200">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={form.bulk}
                                                onChange={(e) => setForm({ ...form, bulk: e.target.checked })}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                disabled={actionLoading}
                                            />
                                            <div>
                                                <span className="text-sm font-medium text-gray-700">Bulk Create Multiple Classrooms</span>
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Create multiple classrooms with sequential numbering
                                                </p>
                                            </div>
                                        </label>

                                        {form.bulk && (
                                            <div className="mt-4 pl-7">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Number of Classrooms *
                                                </label>
                                                <input
                                                    type="number"
                                                    min="2"
                                                    max="50"
                                                    placeholder="e.g., 5"
                                                    value={form.count}
                                                    onChange={(e) => setForm({ ...form, count: parseInt(e.target.value) || 1 })}
                                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                                    required
                                                    disabled={actionLoading}
                                                />
                                                <p className="mt-2 text-xs text-gray-600">
                                                    Will create: {form.name}-1, {form.name}-2, ... {form.name}-{form.count}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

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
                                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {editingClassroom ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingClassroom ? "Update Classroom" : "Create Classroom(s)"
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