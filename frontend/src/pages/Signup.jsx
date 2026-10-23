import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { UserPlus, Eye, EyeOff, Check, X } from "lucide-react";
import LoadingSpinner from "@/components/LoadingSpinner.jsx";
import { register } from "../services/api";

export default function Signup() {
    const navigate = useNavigate();
    const [form, setForm] = useState({
        email: "",
        password: "",
        first_name: "",
        last_name: "",
        confirmPassword: ""
    });
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState({
        length: false,
        uppercase: false,
        lowercase: false,
        number: false,
        special: false,
    });

    const validatePassword = (password) => {
        return {
            length: password.length >= 8,
            uppercase: /[A-Z]/.test(password),
            lowercase: /[a-z]/.test(password),
            number: /\d/.test(password),
            special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
        };
    };

    const handlePasswordChange = (e) => {
        const value = e.target.value;
        setForm({ ...form, password: value });
        setPasswordStrength(validatePassword(value));
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm({
            ...form,
            [name]: value,
        });
        if (error) setError("");
    };

    const validateForm = () => {
        if (form.password !== form.confirmPassword) {
            setError("Passwords do not match");
            return false;
        }

        const strength = validatePassword(form.password);
        const isStrong = Object.values(strength).every(val => val === true);

        if (!isStrong) {
            setError("Password does not meet all requirements");
            return false;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(form.email)) {
            setError("Please enter a valid email address");
            return false;
        }

        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setSuccess("");

        if (!validateForm()) {
            return;
        }

        setLoading(true);

        try {
            const { confirmPassword: _confirmPassword, ...submitData } = form;

            await register(submitData);

            setSuccess("Account created successfully! Redirecting to login...");

            setTimeout(() => {
                navigate("/login");
            }, 2000);

        } catch (err) {
            console.error("Signup error:", err);

            if (err.response) {
                if (err.response.status === 400) {
                    const errors = err.response.data;
                    if (typeof errors === 'object') {
                        const errorMessages = Object.values(errors).flat().join(' ');
                        setError(errorMessages);
                    } else if (errors.detail) {
                        setError(errors.detail);
                    } else if (errors.email) {
                        setError(`Email: ${errors.email[0]}`);
                    } else if (errors.password) {
                        setError(`Password: ${errors.password[0]}`);
                    } else {
                        setError("Registration failed. Please check your information.");
                    }
                } else if (err.response.status === 409) {
                    setError("An account with this email already exists.");
                } else {
                    setError("Registration failed. Please try again.");
                }
            } else if (err.request) {
                setError("Network error. Please check your internet connection.");
            } else {
                setError(err.message || "An unexpected error occurred.");
            }
        } finally {
            setLoading(false);
        }
    };

    const PasswordRequirement = ({ met, text }) => (
        <div className="flex items-center space-x-2">
            {met ? (
                <Check className="h-4 w-4 text-green-500" />
            ) : (
                <X className="h-4 w-4 text-gray-300" />
            )}
            <span className={`text-sm ${met ? 'text-green-600' : 'text-gray-500'}`}>
                {text}
            </span>
        </div>
    );

    return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 to-green-100 p-4">
            <div className="bg-white shadow-2xl rounded-2xl p-8 w-full max-w-md border border-gray-200">
                <div className="flex flex-col items-center mb-8">
                    <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-4 rounded-2xl mb-4 shadow-lg">
                        <UserPlus className="text-white" size={40} />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800">Create Account</h2>
                    <p className="text-sm text-gray-500 mt-1 text-center">
                        Join the institution management system
                    </p>
                </div>

                {success && (
                    <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-green-700 text-sm font-medium">{success}</p>
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-700 text-sm font-medium">{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                First Name
                            </label>
                            <input
                                type="text"
                                name="first_name"
                                placeholder="John"
                                value={form.first_name}
                                onChange={handleChange}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                                disabled={loading}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Last Name
                            </label>
                            <input
                                type="text"
                                name="last_name"
                                placeholder="Doe"
                                value={form.last_name}
                                onChange={handleChange}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                                disabled={loading}
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Email Address
                        </label>
                        <input
                            type="email"
                            name="email"
                            placeholder="john.doe@example.com"
                            value={form.email}
                            onChange={handleChange}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
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
                                placeholder="Create a strong password"
                                value={form.password}
                                onChange={handlePasswordChange}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition pr-12"
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

                        {form.password && (
                            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                                <p className="text-sm font-medium text-gray-700 mb-2">
                                    Password Requirements:
                                </p>
                                <div className="space-y-1">
                                    <PasswordRequirement
                                        met={passwordStrength.length}
                                        text="At least 8 characters"
                                    />
                                    <PasswordRequirement
                                        met={passwordStrength.uppercase}
                                        text="At least one uppercase letter"
                                    />
                                    <PasswordRequirement
                                        met={passwordStrength.lowercase}
                                        text="At least one lowercase letter"
                                    />
                                    <PasswordRequirement
                                        met={passwordStrength.number}
                                        text="At least one number"
                                    />
                                    <PasswordRequirement
                                        met={passwordStrength.special}
                                        text="At least one special character"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Confirm Password
                        </label>
                        <div className="relative">
                            <input
                                type={showConfirmPassword ? "text" : "password"}
                                name="confirmPassword"
                                placeholder="Confirm your password"
                                value={form.confirmPassword}
                                onChange={handleChange}
                                className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition pr-12 ${
                                    form.confirmPassword && form.password !== form.confirmPassword
                                        ? "border-red-300"
                                        : "border-gray-300"
                                }`}
                                disabled={loading}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                        {form.confirmPassword && form.password !== form.confirmPassword && (
                            <p className="mt-1 text-sm text-red-600">
                                Passwords do not match
                            </p>
                        )}
                    </div>

                    <div className="flex items-center space-x-2">
                        <input
                            type="checkbox"
                            id="terms"
                            className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                            required
                        />
                        <label htmlFor="terms" className="text-sm text-gray-600">
                            I agree to the{" "}
                            <button type="button" className="text-green-600 hover:underline">
                                Terms of Service
                            </button>{" "}
                            and{" "}
                            <button type="button" className="text-green-600 hover:underline">
                                Privacy Policy
                            </button>
                        </label>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full py-3 px-4 rounded-lg font-semibold shadow-md transition-all duration-300 ${
                            loading
                                ? "bg-green-400 cursor-not-allowed"
                                : "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 hover:shadow-lg"
                        } text-white flex items-center justify-center`}
                    >
                        {loading ? (
                            <>
                                <LoadingSpinner size="sm" color="light" className="mr-2" />
                                Creating Account...
                            </>
                        ) : (
                            "Sign Up"
                        )}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-gray-200">
                    <p className="text-center text-sm text-gray-600">
                        Already have an account?{" "}
                        <button
                            onClick={() => navigate("/login")}
                            className="text-green-600 font-semibold hover:text-green-800 hover:underline"
                        >
                            Login here
                        </button>
                    </p>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-xs text-gray-400">
                        Your data is protected with industry-standard encryption
                    </p>
                </div>
            </div>
        </div>
    );
}