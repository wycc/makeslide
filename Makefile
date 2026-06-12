DOCKER ?= docker

# Docker Hub account / repository / tag
DOCKERHUB_ACCOUNT ?= wycca1
IMAGE_NAME       ?= makeslide-app
TAG              ?= v1.5.0
IMAGE            ?= $(DOCKERHUB_ACCOUNT)/$(IMAGE_NAME):$(TAG)

# Windows portable zip output path (version follows Docker TAG)
EXE_ZIP ?= dist-electron/MakeSlide-$(TAG)-win-x64.zip

.PHONY: help docker-build docker-push docker-run docker-login dist-win

help:
	@echo "Targets:"
	@echo "  make docker-build                       Build docker image"
	@echo "  make docker-push                        Push docker image to Docker Hub"
	@echo "  make docker-run                         Run container on host port 8888"
	@echo "  make docker-login                       Login Docker Hub"
	@echo "  make dist-win                           Build Windows portable zip (exe)"
	@echo ""
	@echo "Variables (override with make VAR=value ...):"
	@echo "  DOCKERHUB_ACCOUNT=$(DOCKERHUB_ACCOUNT)"
	@echo "  IMAGE_NAME=$(IMAGE_NAME)"
	@echo "  TAG=$(TAG)"
	@echo "  IMAGE=$(IMAGE)"
	@echo "  EXE_ZIP=$(EXE_ZIP)"

docker-build:
	$(DOCKER) build -t $(IMAGE) .

docker-push:
	$(DOCKER) push $(IMAGE)

docker-run:
	$(DOCKER) run --rm -p 8888:8888 --env-file .env $(IMAGE)

docker-login:
	$(DOCKER) login

# Build Windows exe.
# On Windows / CI with wine: electron-builder produces a full NSIS installer.
# On Linux without wine: electron-builder produces win-unpacked/ (icon step
#   fails, suppressed by '-'), which is then zipped manually.
# For a proper Windows release use GitHub Actions (see .github/workflows/release.yml).
dist-win:
	@echo "=== Building MakeSlide $(TAG) for Windows ==="
	npm run build
	npx tsc -p electron/tsconfig.json
	-npx electron-builder --win --config electron-builder.json
	@test -d dist-electron/win-unpacked || \
		(echo "ERROR: dist-electron/win-unpacked not found — packaging failed"; exit 1)
	@echo "=== Creating $(EXE_ZIP) ==="
	@rm -rf dist-electron/_pkg_tmp
	@cp -r dist-electron/win-unpacked dist-electron/_pkg_tmp
	@cd dist-electron && mv _pkg_tmp MakeSlide && \
		zip -r "MakeSlide-$(TAG)-win-x64.zip" MakeSlide/ && \
		mv MakeSlide win-unpacked
	@echo "=== Done: $(EXE_ZIP) (built on Linux — use GH Actions for a production Windows build) ==="

