import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { School, Eye, EyeOff } from "lucide-react";
import useAPI from "../hooks/useAPI";
import LoadingSpinner from "@/components/LoadingSpinner.jsx";

export default function Login() {
    const navigate = useNavigate();
    const api = useAPI();
    const [form, setForm] = useState({ username: "", password: "" });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setSuccessMessage("");
        setLoading(true);

        try {
            const res = await api.post("/token/", form);

            localStorage.setItem("auth_token", res.data.access);
            localStorage.setItem("refresh_token", res.data.refresh);

            if (res.data.user) {
                localStorage.setItem("user", JSON.stringify(res.data.user));
            }

            setSuccessMessage("Login successful! Redirecting...");

            setTimeout(() => {
                navigate("/school");
            }, 1500);

        } catch (err) {
            console.error("Login error:", err);

            if (err.response) {
                if (err.response.status === 401) {
                    setError("Invalid username or password. Please try again.");
                } else if (err.response.status === 400) {
                    setError("Please fill in all required fields.");
                } else if (err.response.status === 500) {
                    setError("Server error. Please try again later.");
                } else {
                    setError("Login failed. Please try again.");
                }
            } else if (err.request) {
                setError("Network error. Please check your internet connection.");
            } else {
                setError("An unexpected error occurred.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setForm(prev => ({
            ...prev,
            [name]: value
        }));
        if (error) setError("");
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
            <div className="bg-white shadow-2xl rounded-2xl p-8 w-full max-w-md border border-gray-200">
                <div className="flex flex-col items-center mb-8">
                    <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-4 rounded-2xl mb-4 shadow-lg">
                        <School className="text-white" size={40} />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800">Institution Login</h2>
                </div>

                {successMessage && (
                    <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-green-700 text-sm font-medium">{successMessage}</p>
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-700 text-sm font-medium">{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Username or Email
                        </label>
                        <input
                            type="text"
                            name="username"
                            placeholder="Enter your username or email"
                            value={form.username}
                            onChange={handleInputChange}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                            disabled={loading}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Password
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                name="password"
                                placeholder="Enter your password"
                                value={form.password}
                                onChange={handleInputChange}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition pr-12"
                                disabled={loading}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-600">Remember me</span>
                        </label>
                        <button
                            type="button"
                            onClick={() => navigate("/forgot-password")}
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                            Forgot password?
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full py-3 px-4 rounded-lg font-semibold shadow-md transition-all duration-300 ${
                            loading
                                ? "bg-blue-400 cursor-not-allowed"
                                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg"
                        } text-white flex items-center justify-center`}
                    >
                        {loading ? (
                            <>
                                <LoadingSpinner size="sm" color="light" className="mr-2" />
                                Signing In...
                            </>
                        ) : (
                            "Sign In"
                        )}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-gray-200">
                    <p className="text-center text-sm text-gray-600">
                        Don't have an account?{" "}
                        <button
                            onClick={() => navigate("/signup")}
                            className="text-blue-600 font-semibold hover:text-blue-800 hover:underline"
                        >
                            Sign up here
                        </button>
                    </p>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-xs text-gray-400">
                        By signing in, you agree to our Terms of Service and Privacy Policy
                    </p>
                </div>
            </div>
        </div>
    );
}