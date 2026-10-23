import React, { createContext, useState, useContext, useEffect } from 'react';

export const SchoolContext = createContext();

export const SchoolProvider = ({ children }) => {
    const [school, setSchool] = useState(null);

    useEffect(() => {
        const savedSchool = localStorage.getItem("school");
        if (savedSchool) {
            try {
                setSchool(JSON.parse(savedSchool));
            } catch (error) {
                console.error("Failed to parse saved school:", error);
                localStorage.removeItem("school");
            }
        }
    }, []);
    

    useEffect(() => {
        if (school) {
            localStorage.setItem("school", JSON.stringify(school));
        } else {
            localStorage.removeItem("school");
        }
    }, [school]);

    return (
        <SchoolContext.Provider value={{ school, setSchool }}>
            {children}
        </SchoolContext.Provider>
    );
};

export const useSchool = () => {
    const context = useContext(SchoolContext);
    if (!context) {
        throw new Error("useSchool must be used within a SchoolProvider");
    }
    return context;
};