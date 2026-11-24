import axios from "axios";
import Swal from "sweetalert2";
import { swalButtonClasses, swalColors } from "../deliveryya_dashboard/comps/addOrders/swalColors";
import JwtUtil from "./JwtUtil";

// export const baseURL = "https://mandarin-uncurled-unranked.ngrok-free.dev";
// export const baseURL = "http://localhost:8080";
export const baseURL = "https://api.deliveryya.lk";
export const fullUrl = baseURL + "/api/v1";
// export const cloudinaryName = "dgja7vikm";
// export const cloudinaryResUrl = "https://res.cloudinary.com/v1_1/" + cloudinaryName;
// export const cloudinaryApiUrl = "https://api.cloudinary.com/v1_1/" + cloudinaryName;


const axiosInstance = axios.create({
    baseURL: fullUrl,
    headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "69420"
    },
    withCredentials: true
});

axiosInstance.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem("jwtToken");
        const isAccessDetailsRequest = config.url?.includes("/access/get-access-details");

        if (isAccessDetailsRequest && (!token || !JwtUtil.validateToken(token))) {
            return Promise.reject(new axios.CanceledError("Access details require a valid session."));
        }

        if (token && JwtUtil.validateToken(token)) {
            config.headers.Authorization = `Bearer ${token}`;
        } else if (token) {
            localStorage.removeItem("jwtToken");
            localStorage.removeItem("userId");
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

axiosInstance.interceptors.response.use(
    (response) => {

        if (response.status === 200) {
            const refreshToken = response.headers["x-token"];
            if (refreshToken) {
                console.log("Something is Changed");
                localStorage.setItem("jwtToken", refreshToken);
            }

        }

        return response
    },
    (error) => {
        if (error.response) {
            const { status } = error.response;

            if (status === 401) {
                localStorage.removeItem("jwtToken");
                localStorage.removeItem("userId");

                Swal.fire({
                    title: 'Your session has ended',
                    text: 'Please sign in again to continue safely.',
                    icon: 'info',
                    confirmButtonText: 'Open sign-in page',
                    showDenyButton: true,
                    denyButtonText: 'Sign in here',
                    showCloseButton: true,
                    confirmButtonColor: swalColors.confirm,
                    iconColor: swalColors.confirm,
                    background: swalColors.background,
                    width: 420,
                    buttonsStyling: false,
                    customClass: {
                        confirmButton: swalButtonClasses.confirm,
                        denyButton: swalButtonClasses.confirm,
                        actions: 'gap-3 flex-wrap'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.open('/sign-in', '_blank');
                    } else if (result.isDenied) {
                        window.location.assign('/sign-in');
                    }
                });
            }

            if (status === 403) {
                Swal.fire({
                    title: 'Access Forbidden',
                    text: 'You do not have permission to perform this action.',
                    icon: 'warning',
                    confirmButtonText: 'OK',
                    confirmButtonColor: swalColors.confirm,
                    iconColor: swalColors.warning,
                    background: swalColors.background,
                    customClass: {
                        confirmButton: swalButtonClasses.confirm,
                        actions: 'gap-4 flex-row'
                    },
                    buttonsStyling: false,
                });
            }

            if (status === 460) {
                Swal.fire({
                    title: 'Accesses are not granted',
                    text: "Something went wrong or You don't have access for the api. Plaase contact administrators to grant access",
                    icon: 'error',
                    confirmButtonText: 'OK',
                    confirmButtonColor: swalColors.confirm,
                    iconColor: swalColors.error,
                    background: swalColors.background,
                    customClass: {
                        confirmButton: swalButtonClasses.confirm,
                        actions: 'gap-4 flex-row'
                    },
                    buttonsStyling: false,
                });
            }

            if (status === 500) {
                Swal.fire({
                    title: 'Server Error',
                    text: 'Something went wrong on our side. Please try again later.',
                    icon: 'error',
                    confirmButtonText: 'OK',
                    confirmButtonColor: swalColors.confirm,
                    iconColor: swalColors.error,
                    background: swalColors.background,
                    customClass: {
                        confirmButton: swalButtonClasses.confirm,
                        actions: 'gap-4 flex-row'
                    },
                    buttonsStyling: false,
                });
            }

        }
        return Promise.reject(error);
        return Promise.reject(error);
    }
);

// Error helpers: use these instead of importing axios in pages and utils.

/** True for errors raised by axiosInstance requests (HTTP error status, network error, timeout). */
export const isAxiosRequestError = axios.isAxiosError;

/** True when a request was cancelled (e.g. the access-details guard in the request interceptor). */
export const isRequestCanceled = axios.isCancel;

/** Axios error type, re-exported so screens never have to import from "axios" directly. */
export type { AxiosError } from "axios";

export default axiosInstance;
