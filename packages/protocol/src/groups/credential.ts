import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { Location } from "@opencode-ai/schema/location"

// Workaround to avoid importing core directly, we just define a schema that matches Info
export const CredentialInfo = Schema.Struct({
  id: Credential.ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Credential.Value,
})

export const CredentialGroup = HttpApiGroup.make("server.credential")
  .add(
    HttpApiEndpoint.get("credential.list", "/api/credential", {
      query: Schema.Struct({
        integrationID: Schema.optional(Integration.ID),
      }),
      success: Location.response(Schema.Array(CredentialInfo)),
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.credential.list",
          summary: "List credentials",
          description: "List stored credentials, optionally filtered by integration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("credential.update", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      query: LocationQuery,
      payload: Schema.Struct({ label: Schema.String }),
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.credential.update",
          summary: "Update credential",
          description: "Update a stored credential label.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("credential.remove", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.credential.remove",
          summary: "Remove credential",
          description: "Remove a stored integration credential.",
        }),
      ),
  )
