import { describe, expect, it } from "vitest";
import {
  CurrentLocationError,
  appendCurrentLocation,
  currentLocationErrorMessage,
  formatCurrentLocation,
  requestCurrentPosition,
} from "../../src/ui/current-location";

const position = {
  coords: {
    latitude: 31.230416,
    longitude: 121.473701,
    accuracy: 12.4,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    toJSON: () => ({}),
  },
  timestamp: 0,
  toJSON: () => ({}),
} satisfies GeolocationPosition;

describe("当前位置输入", () => {
  it("请求高精度位置并允许一分钟内的缓存", async () => {
    let options: PositionOptions | undefined;
    const geolocation = {
      getCurrentPosition(success: PositionCallback, _error?: PositionErrorCallback, next?: PositionOptions) {
        options = next;
        success(position);
      },
      watchPosition: () => 0,
      clearWatch: () => undefined,
    } satisfies Geolocation;

    await expect(requestCurrentPosition(geolocation)).resolves.toBe(position);
    expect(options).toEqual({
      enableHighAccuracy: true,
      maximumAge: 60_000,
      timeout: 15_000,
    });
  });

  it("格式化地图链接、坐标与精度，并追加到已有草稿", () => {
    const location = formatCurrentLocation(position);

    expect(location).toBe(
      "我的当前位置：[31.230416, 121.473701](https://maps.google.com/?q=31.230416,121.473701)（精度约 12 米）",
    );
    expect(appendCurrentLocation("请到这里来  ", location)).toBe(
      `请到这里来\n\n${location}`,
    );
    expect(appendCurrentLocation("", location)).toBe(location);
  });

  it("区分设备不支持、未授权与超时错误", async () => {
    await expect(requestCurrentPosition(null)).rejects.toEqual(
      new CurrentLocationError("unsupported"),
    );
    expect(
      currentLocationErrorMessage(new CurrentLocationError("permission-denied")),
    ).toBe("定位权限未授权");
    expect(
      currentLocationErrorMessage(new CurrentLocationError("timeout")),
    ).toBe("获取当前位置超时，请重试");
  });
});
