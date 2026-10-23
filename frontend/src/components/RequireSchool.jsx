import { Navigate } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { useState, useEffect } from "react";

export default function RequireSchool({ children }) {
    const { school } = useSchool();
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        const checkSchool = () => {
            setIsChecking(false);
        };

        setTimeout(checkSchool, 100);
    }, []);

    if (isChecking) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    const localStorageSchool = localStorage.getItem("school");

    if (!school && !localStorageSchool) {
        return <Navigate to="/school" replace />;
    }

    return children;
}