import { describe, expect, it } from "vitest";
import { validateGoogleTokenInfo } from "../src/auth.js";

const CLIENT_ID = "123-example.apps.googleusercontent.com";
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

describe("Google tokeninfo validation", () => {
  it("accepts the access-token tokeninfo response shape", () => {
    expect(
      validateGoogleTokenInfo(
        {
          issued_to: CLIENT_ID,
          audience: CLIENT_ID,
          user_id: "google-user-1",
          scope: `${YOUTUBE_SCOPE} https://www.googleapis.com/auth/yt-analytics.readonly`,
          expires_in: 1_800,
        },
        CLIENT_ID,
      ),
    ).toEqual({
      subject: "google-user-1",
      ttlSeconds: 300,
    });
  });

  it("accepts the OpenID-style tokeninfo response shape", () => {
    expect(
      validateGoogleTokenInfo(
        {
          azp: CLIENT_ID,
          aud: CLIENT_ID,
          sub: "google-user-2",
          scope: YOUTUBE_SCOPE,
          expires_in: "120",
        },
        CLIENT_ID,
      ),
    ).toEqual({
      subject: "google-user-2",
      ttlSeconds: 120,
    });
  });

  it("rejects a wrong audience, missing scope or expired token", () => {
    expect(
      validateGoogleTokenInfo(
        {
          issued_to: "other.apps.googleusercontent.com",
          user_id: "google-user",
          scope: YOUTUBE_SCOPE,
          expires_in: 300,
        },
        CLIENT_ID,
      ),
    ).toBeUndefined();
    expect(
      validateGoogleTokenInfo(
        {
          issued_to: CLIENT_ID,
          user_id: "google-user",
          scope: "openid email",
          expires_in: 300,
        },
        CLIENT_ID,
      ),
    ).toBeUndefined();
    expect(
      validateGoogleTokenInfo(
        {
          issued_to: CLIENT_ID,
          user_id: "google-user",
          scope: YOUTUBE_SCOPE,
          expires_in: 0,
        },
        CLIENT_ID,
      ),
    ).toBeUndefined();
  });
});
