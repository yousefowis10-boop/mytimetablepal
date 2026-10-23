import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { BookOpen, AlertCircle, CheckCircle, XCircle, ArrowLeft, Hash, Book } from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchSubjectRequirements,
    createSubjectRequirement,
    updateSubjectRequirement,
    deleteSubjectRequirement,
    fetchSubjects
} from "../services/api";

export default function SubjectRequirements() {
    const { studentGroupId } = useParams();
    const navigate = useNavigate();
    const { school } = useSchool();
    const [requirements, setRequirements] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [inputValues, setInputValues] = useState({});

    useEffect(() => {
        if (!school || !studentGroupId) {
            setLoading(false);
            return;
        }

        const loadData = async () => {
            try {
                setLoading(true);
                setError("");

                const [requirementsData, subjectsData] = await Promise.all([
                    fetchSubjectRequirements(studentGroupId),
                    fetchSubjects(school.id)
                ]);

                setRequirements(requirementsData || []);
                setSubjects(subjectsData || []);

                const values = {};
                subjectsData.forEach((subject) => {
                    const requirement = requirementsData.find(r => r.subject === subject.id);
                    values[subject.id] = requirement ? requirement.lectures_per_week : 0;
                });
                setInputValues(values);

            } catch (err) {
                console.error("Failed to load data:", err);
                setError("Failed to load subject requirements. Please try again.");
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [school, studentGroupId]);

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

    const findRequirement = (subjectId) =>
        requirements.find((r) => r.subject === subjectId);


    const handleChange = async (subjectId, value) => {
        const currentReq = findRequirement(subjectId);
        const newValue = parseInt(value, 10) || 0;

        setInputValues((prev) => ({ ...prev, [subjectId]: newValue }));

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            if (!currentReq && newValue > 0) {
                const response = await createSubjectRequirement(
                    studentGroupId,
                    {
                        subject: subjectId,
                        lectures_per_week: newValue,
                        student_group: parseInt(studentGroupId)
                    }
                );

                console.log("Create response:", response);

                let newRequirementData;
                if (Array.isArray(response)) {
                    newRequirementData = response;
                } else if (response && response.data) {
                    newRequirementData = response.data;
                } else {
                    newRequirementData = response;
                }

                setRequirements((prev) => [...prev, ...(Array.isArray(newRequirementData) ? newRequirementData : [newRequirementData])]);
                setSuccess("Subject requirement added successfully!");

            } else if (currentReq && newValue === 0) {
                await deleteSubjectRequirement(studentGroupId, currentReq.id);
                setRequirements((prev) => prev.filter((r) => r.id !== currentReq.id));
                setSuccess("Subject requirement deleted successfully!");

            } else if (currentReq && newValue > 0 && newValue !== currentReq.lectures_per_week) {
                const response = await updateSubjectRequirement(
                    studentGroupId,
                    currentReq.id,
                    {
                        student_group: parseInt(studentGroupId),
                        subject: subjectId,
                        lectures_per_week: newValue
                    }
                );

                console.log("Update response:", response);

                let updatedRequirement;
                if (response && response.data) {
                    updatedRequirement = response.data;
                } else {
                    updatedRequirement = response;
                }

                setRequirements((prev) =>
                    prev.map((r) => (r.id === currentReq.id ? updatedRequirement : r))
                );
                setSuccess("Subject requirement updated successfully!");
            }
        } catch (err) {
            console.error("Error updating subject requirement:", err);
            setError(err.message || "Failed to update requirement. Please try again.");

            setInputValues((prev) => ({
                ...prev,
                [subjectId]: currentReq ? currentReq.lectures_per_week : 0
            }));
        } finally {
            setActionLoading(false);
        }
    };
    const getSubjectName = (subjectId) => {
        const subject = subjects.find(s => s.id === subjectId);
        return subject ? subject.name : "Unknown Subject";
    };

    const totalLectures = requirements.reduce((sum, req) => sum + (req.lectures_per_week || 0), 0);

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <BookOpen className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage subject requirements.</p>
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
                <LoadingSpinner size="lg" text="Loading subject requirements..." />
            </div>
        );
    }

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
                            <BookOpen className="h-7 w-7 text-indigo-600" />
                            Subject Requirements
                        </h1>
                    </div>
                    <p className="text-gray-600 ml-10">
                        Managing requirements for Student Group ID: {studentGroupId}
                    </p>
                    {requirements.length > 0 && (
                        <div className="flex items-center gap-4 mt-2 ml-10 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                                <Book size={14} />
                                {requirements.length} subject(s)
                            </span>
                            <span className="flex items-center gap-1">
                                <Hash size={14} />
                                {totalLectures} total lectures/week
                            </span>
                        </div>
                    )}
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

            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Book className="h-5 w-5 text-indigo-600" />
                        Current Requirements ({requirements.length})
                    </h2>
                    {requirements.length > 0 && (
                        <span className="text-sm text-gray-600 font-medium">
                            Total: {totalLectures} lectures/week
                        </span>
                    )}
                </div>

                <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                    {requirements.length === 0 ? (
                        <div className="text-center py-12">
                            <BookOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-800 mb-2">
                                No subject requirements added yet
                            </h3>
                            <p className="text-gray-600 mb-6">
                                Set lecture counts for subjects below to add requirements
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead className="bg-indigo-600 text-white">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                                        Subject
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                                        Code
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                                        Lectures per Week
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {requirements.map((req) => (
                                    <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">
                                                {getSubjectName(req.subject)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-700">
                                                {subjects.find(s => s.id === req.subject)?.code || "—"}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Hash className="h-4 w-4 text-gray-400" />
                                                <span className="text-sm text-gray-900 font-medium">
                                                        {req.lectures_per_week}
                                                    </span>
                                                <span className="text-xs text-gray-500">
                                                        lectures/week
                                                    </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-800">All Available Subjects</h2>
                    <div className="text-sm text-gray-600">
                        {subjects.length} subject(s) available
                    </div>
                </div>

                <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                    {subjects.length === 0 ? (
                        <div className="text-center py-12">
                            <BookOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-800 mb-2">No subjects available</h3>
                            <p className="text-gray-600">Create subjects first to add requirements</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
                            {subjects.map((subject) => {
                                const currentValue = inputValues[subject.id] || 0;
                                const isSet = currentValue > 0;

                                return (
                                    <div
                                        key={subject.id}
                                        className={`border rounded-lg p-4 transition-all ${isSet ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'}`}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <div className="font-semibold text-gray-800">{subject.name}</div>
                                                <div className="text-sm text-gray-500">{subject.code}</div>
                                            </div>
                                            <div className={`px-2 py-1 rounded text-xs font-medium ${isSet ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-600'}`}>
                                                {isSet ? `${currentValue}/week` : 'Not set'}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600">Lectures/week:</span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="20"
                                                    value={currentValue}
                                                    onChange={(e) => {
                                                        const value = parseInt(e.target.value) || 0;
                                                        setInputValues(prev => ({
                                                            ...prev,
                                                            [subject.id]: value
                                                        }));
                                                    }}
                                                    onBlur={(e) => handleChange(subject.id, e.target.value)}
                                                    disabled={actionLoading}
                                                    className="w-20 p-2 border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition disabled:opacity-50"
                                                />
                                                <span className="text-sm text-gray-500">lectures</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}