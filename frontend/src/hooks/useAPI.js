// src/hooks/useAPI.js
import axios from "axios";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL, TOKEN_KEY } from "../config/api";


export default function useAPI() {
  const navigate = useNavigate();

  // Create axios instance with base config
  const api = useMemo(() => {
    return axios.create({
      baseURL: API_BASE_URL,
    });
  }, []);

  useEffect(() => {
    // Request Interceptor → Add token
    api.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response Interceptor → Handle Unauthorized
    api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          // Token expired or invalid → logout user
          localStorage.removeItem(TOKEN_KEY);
          navigate("/login");
        }
        return Promise.reject(error);
      }
    );
  }, [api, navigate]);

  return api;
}
