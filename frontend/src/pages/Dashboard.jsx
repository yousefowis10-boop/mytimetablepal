import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    CalendarDays,
    Clock,
    Users,
    Building,
    AlertCircle,
    RefreshCw
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import LoadingSpinner from "../components/LoadingSpinner";
import { fetchSchedules, fetchTeachers, fetchClassrooms } from "../services/api";

export default function Dashboard() {
    const [school, setSchool] = useState(null);
    const [schedules, setSchedules] = useState([]);
    const [teachers, setTeachers] = useState([]);
    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [time, setTime] = useState(new Date());
    const navigate = useNavigate();

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const loadDashboardData = async () => {
            try {
                setLoading(true);
                setError("");

                let savedSchool = localStorage.getItem("school");
                if (!savedSchool) {
                    savedSchool = localStorage.getItem("selectedSchool");
                }

                if (!savedSchool) {
                    navigate("/school");
                    return;
                }

                const schoolData = JSON.parse(savedSchool);
                setSchool(schoolData);

                if (!schoolData.id) {
                    throw new Error("Invalid school data");
                }

                const [schedulesData, teachersData, classroomsData] = await Promise.all([
                    fetchSchedules(schoolData.id),
                    fetchTeachers(schoolData.id),
                    fetchClassrooms(schoolData.id)
                ]);

                setSchedules(schedulesData || []);
                setTeachers(teachersData || []);
                setClassrooms(classroomsData || []);

                localStorage.setItem("schedules", JSON.stringify(schedulesData || []));
                localStorage.setItem("teachers", JSON.stringify(teachersData || []));
                localStorage.setItem("classrooms", JSON.stringify(classroomsData || []));

            } catch (err) {
                console.error("Failed to load dashboard data:", err);
                setError("Failed to load dashboard data. Please refresh or select a school.");

                try {
                    const cachedSchedules = localStorage.getItem("schedules");
                    const cachedTeachers = localStorage.getItem("teachers");
                    const cachedClassrooms = localStorage.getItem("classrooms");

                    if (cachedSchedules) setSchedules(JSON.parse(cachedSchedules));
                    if (cachedTeachers) setTeachers(JSON.parse(cachedTeachers));
                    if (cachedClassrooms) setClassrooms(JSON.parse(cachedClassrooms));
                } catch (cacheErr) {
                    console.error("Cache fallback failed:", cacheErr);
                }
            } finally {
                setLoading(false);
            }
        };

        loadDashboardData();
    }, [navigate]);

    const handleRefresh = async () => {
        if (!school?.id) return;

        try {
            setLoading(true);
            setError("");

            const [schedulesData, teachersData, classroomsData] = await Promise.all([
                fetchSchedules(school.id),
                fetchTeachers(school.id),
                fetchClassrooms(school.id)
            ]);

            setSchedules(schedulesData || []);
            setTeachers(teachersData || []);
            setClassrooms(classroomsData || []);

            localStorage.setItem("schedules", JSON.stringify(schedulesData || []));
            localStorage.setItem("teachers", JSON.stringify(teachersData || []));
            localStorage.setItem("classrooms", JSON.stringify(classroomsData || []));

        } catch (err) {
            console.error("Refresh failed:", err);
            setError("Failed to refresh data. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const isSchoolOpen = () => {
        const active = schedules.find((s) => s.is_active && s.periods?.length > 0);
        if (!active) return false;

        const start = active.periods[0]?.start_time;
        const end = active.periods[active.periods.length - 1]?.end_time;
        if (!start || !end) return false;

        const now = time.toTimeString().slice(0, 5);
        return now >= start && now <= end;
    };

    const chartData = classrooms.map((cls) => ({
        name: cls.name,
        capacity: cls.capacity,
    }));

    const hoursData = schedules.map((s) => {
        if (!s.periods || s.periods.length === 0) return { name: s.name, hours: 0 };
        const first = s.periods[0].start_time;
        const last = s.periods[s.periods.length - 1].end_time;

        const toMinutes = (t) => {
            const [h, m] = t.split(":").map(Number);
            return h * 60 + m;
        };

        const totalMinutes = toMinutes(last) - toMinutes(first);
        return {
            name: s.name,
            hours: (totalMinutes / 60).toFixed(1),
        };
    });

    if (loading) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex items-center justify-center">
                <LoadingSpinner size="lg" text="Loading dashboard..." />
            </div>
        );
    }

    if (error && !school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Error Loading Dashboard</h2>
                <p className="text-gray-600 mb-4 text-center">{error}</p>
                <div className="flex gap-4">
                    <button
                        onClick={() => navigate("/school")}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Select School
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                        Refresh Page
                    </button>
                </div>
            </div>
        );
    }

    if (!school) {
        return (
            <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center">
                <Building className="h-20 w-20 text-gray-400 mb-4" />
                <h2 className="text-2xl font-bold text-gray-800 mb-2">No School Selected</h2>
                <p className="text-gray-600 mb-6">Please select or create a school to view the dashboard.</p>
                <button
                    onClick={() => navigate("/school")}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                    Go to School Setup
                </button>
            </div>
        );
    }

    return (
        <div className="p-8 bg-gray-50 min-h-screen space-y-10">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-500 text-white p-8 rounded-2xl shadow-lg relative">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold">Welcome to {school.name}</h1>
                        <p className="mt-2 text-blue-100">Manage your institution efficiently</p>
                        {school.address && (
                            <p className="mt-1 text-blue-100 text-sm opacity-90">{school.address}</p>
                        )}
                    </div>
                    <button
                        onClick={handleRefresh}
                        className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition"
                        title="Refresh data"
                    >
                        <RefreshCw size={18} />
                        <span className="text-sm">Refresh</span>
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        <p className="text-red-700">{error}</p>
                    </div>
                    <button
                        onClick={handleRefresh}
                        className="text-sm text-red-600 hover:text-red-800 underline"
                    >
                        Try again
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4 border border-gray-200">
                    <Building className="h-10 w-10 text-indigo-600" />
                    <div>
                        <p className="text-sm text-gray-500">Classrooms</p>
                        <p className="text-2xl font-bold text-gray-800">{classrooms.length}</p>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4 border border-gray-200">
                    <Users className="h-10 w-10 text-green-600" />
                    <div>
                        <p className="text-sm text-gray-500">Teachers</p>
                        <p className="text-2xl font-bold text-gray-800">{teachers.length}</p>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4 border border-gray-200">
                    <CalendarDays className="h-10 w-10 text-blue-600" />
                    <div>
                        <p className="text-sm text-gray-500">Schedules</p>
                        <p className="text-2xl font-bold text-gray-800">{schedules.length}</p>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow p-6 flex flex-col items-start border border-gray-200">
                    <div className="flex items-center gap-2">
                        <Clock className="h-6 w-6 text-yellow-600" />
                        <p className="font-semibold">{time.toLocaleTimeString()}</p>
                    </div>
                    <span
                        className={`mt-2 px-2 py-1 text-xs font-semibold rounded ${
                            isSchoolOpen()
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                        }`}
                    >
            {isSchoolOpen() ? "School Open" : "School Closed"}
          </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white shadow-lg rounded-2xl border border-gray-200 p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">
                        Daily School Hours by Schedule
                    </h2>
                    {hoursData.length === 0 ? (
                        <p className="text-gray-600">No schedule data available.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart
                                data={hoursData}
                                margin={{ top: 10, right: 20, left: 0, bottom: 20 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis label={{ value: "Hours", angle: -90, position: "insideLeft" }} />
                                <Tooltip formatter={(value) => [`${value} hours`, 'Duration']} />
                                <Legend />
                                <Bar dataKey="hours" stackId="a" fill="#3B82F6" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                <div className="bg-white shadow-lg rounded-2xl border border-gray-200 p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">
                        Classroom Capacity
                    </h2>
                    {classrooms.length === 0 ? (
                        <p className="text-gray-600">No classroom data available.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart
                                data={chartData}
                                margin={{ top: 10, right: 20, left: 0, bottom: 20 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis ticks={[20, 40, 60, 80]} />
                                <Tooltip formatter={(value) => [`${value} students`, 'Capacity']} />
                                <Bar dataKey="capacity" fill="#4F46E5" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            <div className="bg-white shadow-lg rounded-2xl p-8 border border-gray-200">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <CalendarDays className="h-7 w-7 text-blue-600" />
                        <h2 className="text-2xl font-bold text-gray-800">Schedules</h2>
                    </div>
                    <button
                        onClick={() => navigate(`/school/schedules`)}
                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                        Manage Schedules →
                    </button>
                </div>

                {schedules.length === 0 ? (
                    <div className="text-center py-8">
                        <CalendarDays className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-600 mb-4">No schedules created yet.</p>
                        <button
                            onClick={() => navigate(`/school/schedules`)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Create Schedule
                        </button>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {schedules.map((sch, index) => (
                            <div
                                key={sch.id || index}
                                className="border border-gray-200 rounded-xl shadow-sm"
                            >
                                <div className="flex justify-between items-center px-6 py-4 bg-gray-100 rounded-t-xl">
                                    <div className="flex items-center gap-3">
                                        <Clock className="h-5 w-5 text-indigo-600" />
                                        <h3 className="text-lg font-semibold text-gray-800">
                                            {sch.name}
                                        </h3>
                                    </div>
                                    <div className="flex items-center gap-3">
                    <span
                        className={`px-2 py-1 text-xs font-semibold rounded ${
                            sch.is_active
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                        }`}
                    >
                      {sch.is_active ? "Active" : "Inactive"}
                    </span>
                                        <button
                                            onClick={() => navigate(`/school/schedules/${sch.id}/periods`)}
                                            className="text-sm text-blue-600 hover:text-blue-800"
                                        >
                                            View Details
                                        </button>
                                    </div>
                                </div>

                                {sch.periods && sch.periods.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-left">
                                            <thead className="bg-indigo-600 text-white">
                                            <tr>
                                                <th className="px-6 py-3 text-sm font-semibold">#</th>
                                                <th className="px-6 py-3 text-sm font-semibold">Name</th>
                                                <th className="px-6 py-3 text-sm font-semibold">Start</th>
                                                <th className="px-6 py-3 text-sm font-semibold">End</th>
                                                <th className="px-6 py-3 text-sm font-semibold">Type</th>
                                                <th className="px-6 py-3 text-sm font-semibold">Order</th>
                                            </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200">
                                            {sch.periods.map((p, i) => (
                                                <tr key={p.id || i} className="hover:bg-gray-50 transition">
                                                    <td className="px-6 py-3">{i + 1}</td>
                                                    <td className="px-6 py-3 font-medium text-gray-800">
                                                        {p.name}
                                                    </td>
                                                    <td className="px-6 py-3">{p.start_time}</td>
                                                    <td className="px-6 py-3">{p.end_time}</td>
                                                    <td className="px-6 py-3 capitalize">{p.type}</td>
                                                    <td className="px-6 py-3">{p.order}</td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="px-6 py-4 text-center">
                                        <p className="text-gray-500 mb-3">No periods added yet.</p>
                                        <button
                                            onClick={() => navigate(`/school/schedules/${sch.id}/periods`)}
                                            className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                                        >
                                            Add Periods
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="bg-white shadow rounded-xl p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-800 mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <button
                        onClick={() => navigate(`/school/teachers`)}
                        className="p-4 bg-green-50 border border-green-100 rounded-lg hover:bg-green-100 transition-colors text-left"
                    >
                        <Users className="h-6 w-6 text-green-600 mb-2" />
                        <p className="font-medium text-gray-800">Manage Teachers</p>
                        <p className="text-sm text-gray-500">{teachers.length} teachers</p>
                    </button>

                    <button
                        onClick={() => navigate(`/school/classrooms`)}
                        className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-colors text-left"
                    >
                        <Building className="h-6 w-6 text-indigo-600 mb-2" />
                        <p className="font-medium text-gray-800">Classrooms</p>
                        <p className="text-sm text-gray-500">{classrooms.length} rooms</p>
                    </button>

                    <button
                        onClick={() => navigate(`/school/timetables`)}
                        className="p-4 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 transition-colors text-left"
                    >
                        <CalendarDays className="h-6 w-6 text-blue-600 mb-2" />
                        <p className="font-medium text-gray-800">Timetables</p>
                        <p className="text-sm text-gray-500">Manage schedules</p>
                    </button>

                    <button
                        onClick={() => navigate(`/school`)}
                        className="p-4 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors text-left"
                    >
                        <AlertCircle className="h-6 w-6 text-gray-600 mb-2" />
                        <p className="font-medium text-gray-800">School Settings</p>
                        <p className="text-sm text-gray-500">Edit school info</p>
                    </button>
                </div>
            </div>
        </div>
    );
}