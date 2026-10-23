import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Pencil, Plus, Home, LogOut, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { useSchool } from "../context/SchoolContext";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchSchools,
    createSchool,
    updateSchool,
    deleteSchool
} from "../services/api";

export default function School() {
    const navigate = useNavigate();
    const { school, setSchool } = useSchool();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [existingSchools, setExistingSchools] = useState([]);
    const [showExistingSchools, setShowExistingSchools] = useState(false);

    const [form, setForm] = useState({
        name: "",
        address: "",
        principal_name: "",
        established_year: new Date().getFullYear().toString(),
    });

    useEffect(() => {
        const loadExistingSchools = async () => {
            try {
                const schoolsData = await fetchSchools();
                setExistingSchools(schoolsData || []);
            } catch (err) {
                console.error("Failed to fetch existing schools:", err);
            }
        };

        loadExistingSchools();
    }, []);

    useEffect(() => {
        if (error || success) {
            const timer = setTimeout(() => {
                setError("");
                setSuccess("");
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [error, success]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setSuccess("");

        try {
            let savedSchool;

            if (school) {
                savedSchool = await updateSchool(school.id, form);
            } else {
                savedSchool = await createSchool(form);
            }

            setSchool(savedSchool);
            localStorage.setItem("school", JSON.stringify(savedSchool));

            setSuccess(school ? "School updated successfully!" : "School created successfully!");

            setIsModalOpen(false);
            const updatedSchools = await fetchSchools();
            setExistingSchools(updatedSchools || []);

        } catch (err) {
            console.error("School save error:", err);

            let errorMessage = "Failed to save school. Please try again.";

            if (err.message) {
                errorMessage = err.message;
            }

            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = () => {
        if (!school) return;
        setForm({
            name: school.name || "",
            address: school.address || "",
            principal_name: school.principal_name || "",
            established_year: school.established_year?.toString() || new Date().getFullYear().toString(),
        });
        setIsModalOpen(true);
    };

    const handleDelete = async () => {
        if (!school) return;

        if (!window.confirm(`Are you sure you want to delete "${school.name}"? This action cannot be undone and will delete all associated data.`)) {
            return;
        }

        setLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteSchool(school.id);

            setSchool(null);
            localStorage.removeItem("school");

            localStorage.removeItem("schedules");
            localStorage.removeItem("teachers");
            localStorage.removeItem("classrooms");

            const updatedSchools = await fetchSchools();
            setExistingSchools(updatedSchools || []);

            setSuccess("School deleted successfully!");

        } catch (err) {
            console.error("Delete error:", err);
            setError(err.message || "Failed to delete school. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleSelectExistingSchool = (selectedSchool) => {
        setSchool(selectedSchool);
        localStorage.setItem("school", JSON.stringify(selectedSchool));
        setSuccess(`Selected "${selectedSchool.name}"`);

        setTimeout(() => {
            navigate("/school");
        }, 1000);
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setForm(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleCreateNewSchool = () => {
        setSchool(null); // Clear current school to create a new one
        setForm({
            name: "",
            address: "",
            principal_name: "",
            established_year: new Date().getFullYear().toString(),
        });
        setIsModalOpen(true);
    };

    if (loading && !isModalOpen) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <LoadingSpinner size="lg" text="Loading..." />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8  min-h-screen">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800">School Management</h1>
                    <p className="text-gray-600 mt-1">
                        {school ? `Currently viewing: ${school.name}` : "Select or create a school"}
                    </p>
                </div>

                {/* ADDED: Button to create a new school */}
                {school && (
                    <button
                        onClick={handleCreateNewSchool}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Create New School
                    </button>
                )}
            </div>

            {success && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3 animate-fade-in">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-green-800 font-medium">{success}</p>
                    </div>
                    <button
                        onClick={() => setSuccess("")}
                        className="text-green-600 hover:text-green-800"
                        disabled={loading}
                    >
                        <XCircle size={18} />
                    </button>
                </div>
            )}

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 animate-fade-in">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-red-800 font-medium">{error}</p>
                    </div>
                    <button
                        onClick={() => setError("")}
                        className="text-red-600 hover:text-red-800"
                        disabled={loading}
                    >
                        <XCircle size={18} />
                    </button>
                </div>
            )}

            <div className="grid lg:grid-cols-2 gap-8">
                <div className="bg-white shadow-xl rounded-2xl border border-gray-200 p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-blue-600" />
                        {school ? "Current School" : "Welcome"}
                    </h2>

                    {!school ? (
                        <div className="text-center py-8">
                            <Building2 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                            <p className="text-gray-600 mb-6">No school selected yet.</p>

                            <div className="space-y-4">
                                <button
                                    onClick={() => setIsModalOpen(true)}
                                    className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600
                           hover:from-blue-700 hover:to-indigo-700
                           text-white rounded-lg shadow-md font-semibold transition disabled:opacity-50"
                                    disabled={loading}
                                >
                                    <Plus size={18} className="inline mr-2" />
                                    Create New School
                                </button>

                                {existingSchools.length > 0 && (
                                    <button
                                        onClick={() => setShowExistingSchools(!showExistingSchools)}
                                        className="w-full py-3 border-2 border-blue-600 text-blue-600
                             hover:bg-blue-50 rounded-lg font-semibold transition disabled:opacity-50"
                                        disabled={loading}
                                    >
                                        {showExistingSchools ? "Hide Existing Schools" : "Select Existing School"}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-4">
                                <div className="p-4 bg-blue-50 rounded-lg">
                                    <h3 className="text-lg font-semibold text-gray-800">{school.name}</h3>
                                    <p className="text-gray-600 mt-1">{school.address}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <p className="text-sm text-gray-500">Principal</p>
                                        <p className="font-medium text-gray-800">{school.principal_name}</p>
                                    </div>
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <p className="text-sm text-gray-500">Established</p>
                                        <p className="font-medium text-gray-800">{school.established_year}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 flex flex-col sm:flex-row gap-3">
                                <button
                                    onClick={handleEdit}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3
                           border-2 border-indigo-600 text-indigo-600
                           hover:bg-indigo-600 hover:text-white rounded-lg transition disabled:opacity-50"
                                    disabled={loading}
                                >
                                    <Pencil size={18} /> Edit School
                                </button>
                                <button
                                    onClick={handleDelete}
                                    className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600
                           text-white rounded-lg shadow-sm transition disabled:opacity-50"
                                    disabled={loading}
                                >
                                    Delete School
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="bg-white shadow-xl rounded-2xl border border-gray-200 p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-green-600" />
                        {showExistingSchools && existingSchools.length > 0 ? "Your Schools" : "Quick Start"}
                    </h2>

                    {showExistingSchools && existingSchools.length > 0 ? (
                        <div className="space-y-3">
                            {existingSchools.map((sch) => (
                                <div
                                    key={sch.id}
                                    onClick={() => handleSelectExistingSchool(sch)}
                                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                                        school?.id === sch.id
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-gray-200 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-semibold text-gray-800">{sch.name}</h3>
                                            <p className="text-sm text-gray-600 mt-1">{sch.address}</p>
                                        </div>
                                        {school?.id === sch.id && (
                                            <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">
                        Current
                      </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                                        <span>Principal: {sch.principal_name}</span>
                                        <span>Est. {sch.established_year}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="p-4 bg-green-50 rounded-lg">
                                <h3 className="font-semibold text-green-800 mb-2">Getting Started</h3>
                                <ul className="space-y-2 text-sm text-green-700">
                                    <li className="flex items-center gap-2">
                                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                                        <span>Create your school profile</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                                        <span>Add teachers and their subjects</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                                        <span>Create classrooms and schedules</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                                        <span>Generate timetables automatically</span>
                                    </li>
                                </ul>
                            </div>

                            {existingSchools.length > 0 && (
                                <button
                                    onClick={() => setShowExistingSchools(true)}
                                    className="w-full py-3 border-2 border-green-600 text-green-600
                           hover:bg-green-50 rounded-lg font-semibold transition disabled:opacity-50"
                                    disabled={loading}
                                >
                                    View All Your Schools ({existingSchools.length})
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold text-gray-800">
                                    {/* FIXED: Show correct title based on whether we're creating or editing */}
                                    {form.name || !school ? "Create New School" : "Edit School"}
                                </h2>
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                                    disabled={loading}
                                >
                                    ✕
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        School Name *
                                    </label>
                                    <input
                                        type="text"
                                        name="name"
                                        placeholder="e.g., Springfield High School"
                                        value={form.name}
                                        onChange={handleInputChange}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={loading}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Address *
                                    </label>
                                    <textarea
                                        name="address"
                                        placeholder="Full school address"
                                        value={form.address}
                                        onChange={handleInputChange}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        rows="3"
                                        required
                                        disabled={loading}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Principal Name *
                                        </label>
                                        <input
                                            type="text"
                                            name="principal_name"
                                            placeholder="e.g., John Smith"
                                            value={form.principal_name}
                                            onChange={handleInputChange}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                            required
                                            disabled={loading}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Established Year *
                                        </label>
                                        <input
                                            type="number"
                                            name="established_year"
                                            placeholder="e.g., 1995"
                                            value={form.established_year}
                                            onChange={handleInputChange}
                                            min="1800"
                                            max={new Date().getFullYear()}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                            required
                                            disabled={loading}
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="px-5 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
                                        disabled={loading}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {loading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light" />
                                                {/* FIXED: Show correct button text based on whether we're creating or editing */}
                                                {school && form.name ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            /* FIXED: Show correct button text based on whether we're creating or editing */
                                            school && form.name ? "Update School" : "Create School"
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