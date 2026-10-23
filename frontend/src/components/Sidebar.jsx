import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  School,
  BookOpen,
  Users,
  GraduationCap,
  CalendarClock,
  CalendarDays,
} from "lucide-react";

export default function Sidebar({ isOpen }) {
  return (
    <div
      className={`${
        isOpen ? "w-64" : "w-20"
      } bg-blue-900 text-white flex flex-col fixed top-0 left-0 h-full shadow-lg transition-all duration-300`}
    >
      {/* Sidebar Header */}
      <div className="flex items-center gap-3 p-6 border-b border-blue-800">
        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
          <span className="text-blue-900 font-bold text-lg">I</span>
        </div>
        {isOpen && (
          <h1 className="text-xl font-bold tracking-wide">Institution</h1>
        )}
      </div>

      {/* Sidebar Menu */}
      <nav className="flex flex-col p-4 space-y-2 mt-2">
        {/*<Link*/}
        {/*  to="/school/dashboard"*/}
        {/*  className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"*/}
        {/*>*/}
        {/*  <LayoutDashboard size={20} />*/}
        {/*  {isOpen && <span className="text-sm font-medium">Dashboard</span>}*/}
        {/*</Link>*/}

        <Link
          to="/school"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"
        >
          <School size={20} />
          {isOpen && <span className="text-sm font-medium">School</span>}
        </Link>

        <Link
          to="/school/subjects"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"
        >
          <BookOpen size={20} />
          {isOpen && <span className="text-sm font-medium">Subjects</span>}
        </Link>

        <Link
          to="/school/classrooms"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"
        >
          <GraduationCap size={20} />
          {isOpen && <span className="text-sm font-medium">Classrooms</span>}
        </Link>

        <Link
          to="/school/teachers"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"
        >
          <Users size={20} />
          {isOpen && <span className="text-sm font-medium">Teachers</span>}
        </Link>

        {/* Student Groups above Schedules */}
        <Link
          to="/school/groups"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"
        >
          <Users size={20} />
          {isOpen && <span className="text-sm font-medium">Student Groups</span>}
        </Link>

        <Link
          to="/school/schedules"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"
        >
          <CalendarClock size={20} />
          {isOpen && <span className="text-sm font-medium">Schedules</span>}
        </Link>

        <Link
          to="/school/timetables"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-800 transition"
        >
          <CalendarDays size={20} />
          {isOpen && <span className="text-sm font-medium">Timetables</span>}
        </Link>
      </nav>
    </div>
  );
}
