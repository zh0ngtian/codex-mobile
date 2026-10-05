import { t } from "../i18n";

export type CurrentLocationFailure =
  | "unsupported"
  | "permission-denied"
  | "unavailable"
  | "timeout";

export class CurrentLocationError extends Error {
  constructor(readonly reason: CurrentLocationFailure) {
    super(reason);
    this.name = "CurrentLocationError";
  }
}

export function requestCurrentPosition(
  geolocation: Geolocation | null | undefined = navigator.geolocation,
) {
  if (!geolocation) {
    return Promise.reject(new CurrentLocationError("unsupported"));
  }

  return new Promise<GeolocationPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, (error) => {
      const reason: CurrentLocationFailure =
        error.code === 1
          ? "permission-denied"
          : error.code === 3
            ? "timeout"
            : "unavailable";
      reject(new CurrentLocationError(reason));
    }, {
      enableHighAccuracy: true,
      maximumAge: 60_000,
      timeout: 15_000,
    });
  });
}

export function formatCurrentLocation(position: GeolocationPosition) {
  const latitude = position.coords.latitude.toFixed(6);
  const longitude = position.coords.longitude.toFixed(6);
  const accuracy = Math.max(1, Math.round(position.coords.accuracy));
  const url = `https://maps.google.com/?q=${latitude},${longitude}`;
  return t("我的当前位置：[{latitude}, {longitude}]({url})（精度约 {accuracy} 米）", {
    latitude,
    longitude,
    url,
    accuracy,
  });
}

export function appendCurrentLocation(draft: string, location: string) {
  return draft.trimEnd() ? `${draft.trimEnd()}\n\n${location}` : location;
}

export function currentLocationErrorMessage(error: unknown) {
  if (error instanceof CurrentLocationError) {
    if (error.reason === "unsupported") return t("此设备不支持定位");
    if (error.reason === "permission-denied") return t("定位权限未授权");
    if (error.reason === "timeout") return t("获取当前位置超时，请重试");
  }
  return t("无法获取当前位置，请重试");
}
