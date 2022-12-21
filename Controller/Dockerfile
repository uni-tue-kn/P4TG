FROM python:3.8-buster
COPY requirements.txt /requirements.txt
RUN pip install -r requirements.txt
RUN mkdir /app
WORKDIR /app
ENTRYPOINT ["./controller.py"]

