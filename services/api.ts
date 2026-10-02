import AsyncStorage from "@react-native-async-storage/async-storage";
import CookieManager from "@react-native-cookies/cookies";

// region: --- Interface Definitions ---
export interface DoubanItem {
  title: string;
  poster: string;
  rate?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
}

export class API {
  public baseURL: string = "";

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    this.baseURL = url;
  }

  private async _fetch(url: string, options: RequestInit = {}, includeAuthCookies = true): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    const baseURL = this.baseURL;
    const headers = new Headers(options.headers);

    if (includeAuthCookies) {
      // Android's CookieManager and React Native fetch do not always share the
      // same cookie jar. Read native cookies and forward them explicitly.
      let cookieHeader = "";
      try {
        const nativeCookies = await CookieManager.get(baseURL);
        cookieHeader = Object.entries(nativeCookies)
          .filter(([, cookie]) => typeof cookie?.value === "string")
          .map(([name, cookie]) => `${cookie.name || name}=${cookie.value}`)
          .join("; ");
      } catch {
        // Fall back to the AsyncStorage copy below.
      }

      const cookies = await AsyncStorage.getItem("authCookies");
      const cookieBaseURL = await AsyncStorage.getItem("authCookiesBaseUrl");
      if (!cookieHeader && cookies && (!cookieBaseURL || cookieBaseURL === baseURL)) {
        // Stored values may be Set-Cookie headers from older installations.
        // Split between cookies, but not at the comma inside an Expires date.
        cookieHeader = cookies.split(/,(?=\s*[^;,=\s]+=)/)
          .map(cookie => cookie.split(";")[0].trim())
          .filter(Boolean)
          .join("; ");
      }
      if (cookieHeader) {
        headers.set("Cookie", cookieHeader);
      }
    }

    const response = await fetch(`${baseURL}${url}`, {
      credentials: "include",
      ...options,
      headers,
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      let detail = "";
      try {
        if (typeof response.text === "function") {
          const body = await response.text();
          if (body) {
            try {
              const parsed = JSON.parse(body);
              detail = parsed?.error || parsed?.message || body;
            } catch {
              detail = body;
            }
          }
        }
      } catch {
        // Keep the generic status message if the response body cannot be read.
      }
      const suffix = detail ? `: ${detail.slice(0, 160)}` : "";
      throw new Error(`HTTP ${response.status}${suffix}`);
    }

    return response;
  }

  async login(username?: string | undefined, password?: string): Promise<{ ok: boolean }> {
    const baseURL = this.baseURL;
    const normalizedUsername = username?.trim() || undefined;
    const response = await this._fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ username: normalizedUsername, password }),
    }, false);

    const result = await response.json();
    if (!result.ok) {
      throw new Error("用户名或密码错误");
    }
    if (this.baseURL !== baseURL) {
      throw new Error("服务器地址已更改，请重新登录");
    }

    // On Android, fetch may store cookies natively while hiding Set-Cookie
    // from JavaScript. Import the header when it is visible, then verify the
    // native cookie store instead of assuming response.headers is authoritative.
    const setCookieHeader = response.headers.get("Set-Cookie");
    if (setCookieHeader) {
      try {
        await CookieManager.setFromResponse(baseURL, setCookieHeader);
      } catch {
        // Native fetch may already have stored it; verification below decides.
      }
    }

    try {
      await CookieManager.flush();
    } catch {
      // flush is Android-specific; ignore if unavailable.
    }

    let nativeAuthValue: string | undefined;
    try {
      const nativeCookies = await CookieManager.get(baseURL);
      nativeAuthValue = nativeCookies.auth?.value;
    } catch {
      // Fall back to the exposed response header below.
    }

    await AsyncStorage.setItem("authCookiesBaseUrl", baseURL);
    if (nativeAuthValue) {
      // Keep a JS-side backup for older devices whose native fetch cookie
      // handling is unreliable, but prefer the native store on requests.
      await AsyncStorage.setItem("authCookies", `auth=${nativeAuthValue}`);
    } else if (setCookieHeader) {
      await AsyncStorage.setItem("authCookies", setCookieHeader);
    } else {
      await AsyncStorage.removeItem("authCookies");
      await AsyncStorage.removeItem("authCookiesBaseUrl");
      throw new Error("登录成功，但电视端未保存认证 Cookie");
    }

    return result;
  }

  async logout(): Promise<{ ok: boolean }> {
    try {
      const response = await this._fetch("/api/logout", {
        method: "POST",
      });
      return await response.json();
    } finally {
      await AsyncStorage.removeItem("authCookies");
      await AsyncStorage.removeItem("authCookiesBaseUrl");
      try {
        await CookieManager.clearAll();
      } catch {
        // Best effort: AsyncStorage session is already cleared above.
      }
    }
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  async getDoubanData(
    type: "movie" | "tv",
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url = `/api/douban?type=${type}&tag=${encodeURIComponent(tag)}&pageSize=${pageSize}&pageStart=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideos(query: string): Promise<{ results: SearchResult[] }> {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }
}

// 默认实例
export let api = new API();

