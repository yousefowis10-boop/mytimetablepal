import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Menu, Building2, ChevronDown, Check } from "lucide-react";
import { useSchool } from "../context/SchoolContext";
import { fetchSchools } from "../services/api";

export default function Navbar({ onToggleSidebar }) {
    const navigate = useNavigate();
    const { school, setSchool } = useSchool(); // Get school from context

    const [schools, setSchools] = useState([]);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Fetch schools on mount
    useEffect(() => {
        const fetchAllSchools = async () => {
            try {
                const schoolsData = await fetchSchools();
                setSchools(schoolsData || []);

                // Check if we already have a school selected in context
                if (school) {
                    // School already selected in context, nothing to do
                } else if (schoolsData && schoolsData.length > 0) {
                    // Otherwise set the first school as default
                    setSchool(schoolsData[0]);
                }
            } catch (err) {
                console.error("Failed to fetch schools:", err);
            }
        };
        fetchAllSchools();
    }, []);

    // Handle school change
    const handleSchoolChange = (selectedSchool) => {
        setSchool(selectedSchool);
        localStorage.setItem("school", JSON.stringify(selectedSchool));
        setDropdownOpen(false);

        // Force a page reload to refresh all data
        window.location.reload();
    };

    // Handle logout
    const handleLogout = () => {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("school");
        setSchool(null);
        navigate("/login");
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <div className="h-20 bg-white shadow-md flex items-center justify-between px-6">
            {/* Left: Menu Button */}
            <button
                onClick={onToggleSidebar}
                className="p-2 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition"
                title="Toggle Sidebar"
            >
                <Menu size={22} />
            </button>

            {/* Right: School Dropdown + Logout */}
            <div className="flex items-center gap-4">
                {/* School Dropdown */}
                {school && (
                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition"
                        >
                            <Building2 size={18} />
                            <span className="max-w-xs truncate">{school.name}</span>
                            <ChevronDown size={16} />
                        </button>

                        {dropdownOpen && schools.length > 0 && (
                            <div className="absolute right-0 mt-2 w-64 bg-white border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                                <div className="p-2 border-b">
                                    <p className="text-xs text-gray-500 font-medium px-2 py-1">SELECT SCHOOL</p>
                                </div>
                                {schools.map((sch) => (
                                    <button
                                        key={sch.id}
                                        onClick={() => handleSchoolChange(sch)}
                                        className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-indigo-50 transition ${
                                            school.id === sch.id ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700'
                                        }`}
                                    >
                                        <div className="flex flex-col">
                                            <span className="font-medium">{sch.name}</span>
                                            <span className="text-xs text-gray-500 truncate">{sch.address}</span>
                                        </div>
                                        {school.id === sch.id && (
                                            <Check size={16} className="text-green-600" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Logout Button */}
                <button
                    onClick={handleLogout}
                    className="p-2 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition"
                    title="Logout"
                >
                    <LogOut size={20} />
                </button>
            </div>
        </div>
    );
}