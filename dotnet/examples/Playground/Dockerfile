# Build context: the dotnet/ folder. compose.yaml sets it.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/ src/
COPY examples/QuickStart/sample.bundle.json examples/QuickStart/sample-data.ttl examples/QuickStart/
COPY examples/Playground/ examples/Playground/
RUN dotnet publish examples/Playground -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:5080
EXPOSE 5080
ENTRYPOINT ["dotnet", "Playground.dll"]
