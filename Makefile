DOCKER ?= docker

# Docker Hub account / repository / tag
DOCKERHUB_ACCOUNT ?= wycca1
IMAGE_NAME ?= makeslide-app
TAG ?= v1.0.7
IMAGE ?= $(DOCKERHUB_ACCOUNT)/$(IMAGE_NAME):$(TAG)

.PHONY: help docker-build docker-push docker-run docker-login

help:
	@echo "Targets:"
	@echo "  make docker-build                       Build docker image"
	@echo "  make docker-push                        Push docker image to Docker Hub"
	@echo "  make docker-run                         Run container on host port 8888"
	@echo "  make docker-login                       Login Docker Hub"
	@echo ""
	@echo "Variables (override with make VAR=value ...):"
	@echo "  DOCKERHUB_ACCOUNT=$(DOCKERHUB_ACCOUNT)"
	@echo "  IMAGE_NAME=$(IMAGE_NAME)"
	@echo "  TAG=$(TAG)"
	@echo "  IMAGE=$(IMAGE)"

docker-build:
	$(DOCKER) build -t $(IMAGE) .

docker-push:
	$(DOCKER) push $(IMAGE)

docker-run:
	$(DOCKER) run --rm -p 8888:8888 --env-file .env $(IMAGE)

docker-login:
	$(DOCKER) login

