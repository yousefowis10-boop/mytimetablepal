import {useState, useEffect} from "react";
import {useParams, useNavigate} from "react-router-dom";
import {useSchool} from "../context/SchoolContext";
import {Calendar, Plus, Trash2, Edit, Clock, AlertCircle, CheckCircle, XCircle, ArrowLeft} from "lucide-react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
    fetchTeacherAvailability,
    createAvailability,
    updateAvailability,
    deleteAvailability
} from "../services/api";

export default function Availability() {
    const {teacherId} = useParams();
    const navigate = useNavigate();
    const {school} = useSchool();
    const [slots, setSlots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSlot, setEditingSlot] = useState(null);
    const [form, setForm] = useState({
        slot: "",
        start_time: "",
        end_time: "",
        day_of_week: ""
    });

    useEffect(() => {
        if (!school) {
            setLoading(false);
            return;
        }

        const loadAvailability = async () => {
            try {
                setLoading(true);
                setError("");
                const data = await fetchTeacherAvailability(school.id, teacherId);
                setSlots(data || []);
            } catch (err) {
                console.error("Error fetching availability:", err);
                setError("Failed to load availability slots. Please try again.");
            } finally {
                setLoading(false);
            }
        };

        loadAvailability();
    }, [teacherId, school]);

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
        setForm({slot: "", start_time: "", end_time: "", day_of_week: ""});
        setEditingSlot(null);
        setIsModalOpen(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!school) {
            setError("Please select or create a school first!");
            return;
        }

        if (!form.start_time || !form.end_time) {
            setError("Please provide both start and end times");
            return;
        }

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            if (editingSlot) {
                // Update slot
                const updatedSlot = await updateAvailability(
                    school.id,
                    teacherId,
                    editingSlot.id,
                    form
                );

                setSlots(slots.map(slot =>
                    slot.id === editingSlot.id ? updatedSlot.data : slot
                ));
                setSuccess(`Slot "${form.slot}" updated successfully!`);
            } else {
                const newSlot = await createAvailability(school.id, teacherId, form);
                setSlots([...slots, newSlot.data]);
                setSuccess(`Slot "${form.slot}" created successfully!`);
            }

            resetForm();
        } catch (err) {
            console.error("Error saving slot:", err);
            setError(err.message || "Failed to save availability slot. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async (slotId, slotName) => {
        if (!confirm(`Are you sure you want to delete "${slotName}"?`)) return;
        if (!school) return;

        setActionLoading(true);
        setError("");
        setSuccess("");

        try {
            await deleteAvailability(school.id, teacherId, slotId);
            setSlots(slots.filter((s) => s.id !== slotId));
            setSuccess(`Slot "${slotName}" deleted successfully!`);
        } catch (err) {
            console.error("Error deleting slot:", err);
            setError(err.message || "Failed to delete slot. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEdit = (slot) => {
        setForm({
            slot: slot.slot || "",
            start_time: slot.start_time || "",
            end_time: slot.end_time || "",
            day_of_week: slot.day_of_week || ""
        });
        setEditingSlot(slot);
        setIsModalOpen(true);
    };

    const formatTime = (time) => {
        if (!time) return "";
        const [hours, minutes] = time.split(":");
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? "PM" : "AM";
        const hour12 = hour % 12 || 12;
        return `${hour12}:${minutes} ${ampm}`;
    };

    const getDayName = (dayNumber) => {
        const days = {
            1: "Monday",
            2: "Tuesday",
            3: "Wednesday",
            4: "Thursday",
            5: "Friday",
            6: "Saturday",
            7: "Sunday"
        };
        return days[dayNumber] || "Everyday";
    };

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Calendar className="h-20 w-20 text-gray-400 mb-4"/>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6 text-center">Please select or create a school to manage
                    availability.</p>
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
                <LoadingSpinner size="lg" text="Loading availability slots..."/>
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
                            <ArrowLeft size={20}/>
                        </button>
                        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                            <Calendar className="h-7 w-7 text-indigo-600"/>
                            Availability Schedule
                        </h1>
                    </div>
                    <p className="text-gray-600 ml-10">
                        Managing availability for Teacher ID: {teacherId}
                    </p>
                    {slots.length > 0 && (
                        <div className="flex items-center gap-4 mt-2 ml-10 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Clock size={14}/>
                  {slots.length} slot(s)
              </span>
                        </div>
                    )}
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={() => {
                            resetForm();
                            setIsModalOpen(true);
                        }}
                        disabled={actionLoading}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg shadow-md font-medium transition disabled:opacity-50"
                    >
                        <Plus size={18}/>
                        Add Slot
                    </button>
                </div>
            </div>

            {success && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0"/>
                    <div className="flex-1">
                        <p className="text-green-800 font-medium">{success}</p>
                    </div>
                    <button onClick={() => setSuccess("")} className="text-green-600 hover:text-green-800">
                        <XCircle size={18}/>
                    </button>
                </div>
            )}

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0"/>
                    <div className="flex-1">
                        <p className="text-red-800 font-medium">{error}</p>
                    </div>
                    <button onClick={() => setError("")} className="text-red-600 hover:text-red-800">
                        <XCircle size={18}/>
                    </button>
                </div>
            )}

            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {slots.length === 0 ? (
                    <div className="text-center py-12">
                        <Clock className="h-16 w-16 text-gray-300 mx-auto mb-4"/>
                        <h3 className="text-lg font-medium text-gray-800 mb-2">
                            No availability slots added yet
                        </h3>
                        <p className="text-gray-600 mb-6">
                            Add your first availability slot to define when this teacher is available
                        </p>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Add First Slot
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Slot Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Day
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        Start Time
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        End Time
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider text-right">
                                        Actions
                                    </th>
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                {slots.map((slot) => (
                                    <tr key={slot.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{slot.slot}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-700">
                                                {getDayName(slot.day_of_week)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-gray-400"/>
                                                <span className="text-sm text-gray-900 font-medium">
                            {formatTime(slot.start_time)}
                          </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-gray-400"/>
                                                <span className="text-sm text-gray-900 font-medium">
                            {formatTime(slot.end_time)}
                          </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleEdit(slot)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Edit size={14}/>
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(slot.id, slot.slot)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-red-400 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                                                >
                                                    <Trash2 size={14}/>
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
                            <div className="text-sm text-gray-600">
                                Showing {slots.length} slot(s)
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
                                    {editingSlot ? "Edit Availability Slot" : "Add Availability Slot"}
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
                                        Slot Name *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g., Morning Session, Afternoon Lab"
                                        value={form.slot}
                                        onChange={(e) => setForm({...form, slot: e.target.value})}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        required
                                        disabled={actionLoading}
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Descriptive name for this time slot
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Day of Week
                                    </label>
                                    <select
                                        value={form.day_of_week}
                                        onChange={(e) => setForm({...form, day_of_week: e.target.value})}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                        disabled={actionLoading}
                                    >
                                        <option value="">Everyday (Default)</option>
                                        <option value="1">Monday</option>
                                        <option value="2">Tuesday</option>
                                        <option value="3">Wednesday</option>
                                        <option value="4">Thursday</option>
                                        <option value="5">Friday</option>
                                        <option value="6">Saturday</option>
                                        <option value="7">Sunday</option>
                                    </select>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Leave empty if this slot applies to all days
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Start Time *
                                        </label>
                                        <input
                                            type="time"
                                            value={form.start_time}
                                            onChange={(e) => setForm({...form, start_time: e.target.value})}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
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
                                            onChange={(e) => setForm({...form, end_time: e.target.value})}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:opacity-50"
                                            required
                                            disabled={actionLoading}
                                        />
                                    </div>
                                </div>

                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                                    <div className="flex items-start gap-3">
                                        <Clock className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0"/>
                                        <div>
                                            <p className="text-sm font-medium text-blue-800">Time Preview</p>
                                            <p className="text-sm text-blue-700 mt-1">
                                                {form.start_time && form.end_time
                                                    ? `${formatTime(form.start_time)} - ${formatTime(form.end_time)}`
                                                    : "Enter times to see preview"
                                                }
                                            </p>
                                        </div>
                                    </div>
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
                                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md transition flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading ? (
                                            <>
                                                <LoadingSpinner size="sm" color="light"/>
                                                {editingSlot ? "Updating..." : "Creating..."}
                                            </>
                                        ) : (
                                            editingSlot ? "Update Slot" : "Create Slot"
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