import {BrowserRouter as Router, Routes, Route, Navigate} from "react-router-dom";
import {SchoolProvider} from "./context/SchoolContext";

import ScrollToTop from "./ScrollToTop"
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import MainLayout from "./layouts/MainLayout";
import School from "./pages/School";
import Subject from "./pages/Subject";
import Classroom from "./pages/Classroom";
import Teacher from "./pages/Teacher";
import Schedule from "./pages/Schedule";
import SchedulePeriods from "./pages/SchedulePeriods";
import RequireSchool from "./components/RequireSchool";
import Timetable from "./pages/Timetable";
import StudentGroups from "./pages/StudentGroups";
import VisualTimetable from "./pages/VisualTimetable";
import Availability from "./pages/Availability"; // 👈 NEW import
import SubjectRequirements from "./pages/SubjectRequirements";
import { Toaster } from "react-hot-toast";

function App() {
    return (
        <SchoolProvider>

            <Router>
                <ScrollToTop/>
                <Toaster
                    position="top-right"
                    reverseOrder={false}
                    toastOptions={{
                        duration: 4000,
                        style: {
                            background: '#363636',
                            color: '#fff',
                        },
                        success: {
                            duration: 3000,
                            theme: {
                                primary: 'green',
                                secondary: 'black',
                            },
                        },
                        error: {
                            duration: 4000,
                            theme: {
                                primary: 'red',
                                secondary: 'black',
                            },
                        },
                    }}
                />

                <Routes>
                    {/* Public Routes */}
                    <Route path="/login" element={<Login/>}/>
                    <Route path="/signup" element={<Signup/>}/>

                    {/* Default redirect */}
                    <Route path="/" element={<Navigate to="/login"/>}/>

                    {/* Protected Routes with Layout */}
                    <Route element={<MainLayout/>}>
                        {/* School creation/selection */}
                        <Route path="/school" element={<School/>}/>

                        {/* Everything else requires a school */}
                        {/*<Route*/}
                        {/*    path="/school/dashboard"*/}
                        {/*    element={*/}
                        {/*        <RequireSchool>*/}
                        {/*            <Dashboard/>*/}
                        {/*        </RequireSchool>*/}
                        {/*    }*/}
                        {/*/>*/}

                        <Route
                            path="/school/subjects"
                            element={
                                <RequireSchool>
                                    <Subject/>
                                </RequireSchool>
                            }
                        />

                        <Route
                            path="/school/teachers"
                            element={
                                <RequireSchool>
                                    <Teacher/>
                                </RequireSchool>
                            }
                        />

                        {/* 👇 NEW ROUTE for teacher availability */}
                        <Route
                            path="/school/teachers/:teacherId/availability"
                            element={
                                <RequireSchool>
                                    <Availability/>
                                </RequireSchool>
                            }
                        />

                        <Route
                            path="/school/classrooms"
                            element={
                                <RequireSchool>
                                    <Classroom/>
                                </RequireSchool>
                            }
                        />

                        <Route
                            path="/school/schedules"
                            element={
                                <RequireSchool>
                                    <Schedule/>
                                </RequireSchool>
                            }
                        />

                        <Route
                            path="/school/schedules/:scheduleId/periods"
                            element={
                                <RequireSchool>
                                    <SchedulePeriods/>
                                </RequireSchool>
                            }
                        />

                        <Route
                            path="/school/timetables"
                            element={
                                <RequireSchool>
                                    <Timetable/>
                                </RequireSchool>
                            }
                        />

                        {/* <Route
              path="/school/timetables/:id/entries"
              element={
                <RequireSchool>
                  <TimetableEntries />
                </RequireSchool>
              }
            /> */}

                        <Route
                            path="/school/timetables/:id/visual"
                            element={
                                <RequireSchool>
                                    <VisualTimetable/>
                                </RequireSchool>
                            }
                        />

                        <Route
                            path="/school/groups"
                            element={
                                <RequireSchool>
                                    <StudentGroups/>
                                </RequireSchool>
                            }
                        />

                        <Route
                            path="/school/groups/:studentGroupId/subject-requirement"
                            element={
                                <RequireSchool>
                                    <SubjectRequirements/>
                                </RequireSchool>
                            }
                        />
                    </Route>

                    {/* Catch-all for unknown routes */}
                    <Route path="*" element={<Navigate to="/login" replace/>}/>
                </Routes>
            </Router>
        </SchoolProvider>
    );
}

export default App;
