cmake_minimum_required(VERSION 3.10)
project(CppChess CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
  add_compile_options(/O2 /W3)
else()
  add_compile_options(-O2 -Wall)
endif()

add_executable(cppchess
  main.cpp
  chess_core.cpp
  chess_ai.cpp
  tests.cpp
)
